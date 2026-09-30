import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { assertNotBlocked } from '../auth/blocked';
import { AdStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { countUnreadMessages } from './unread';
import { EMAIL_SENDER_TOKEN, EmailSender } from '../auth/email-sender.interface';

type Role = 'buyer' | 'seller';

const PERSON = { select: { id: true, name: true, avatar: true } } as const;
const SITE_URL = process.env.FRONTEND_URL || 'https://xn----7sbhf4acwc1a.xn--p1ai';

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER_TOKEN) private readonly email: EmailSender,
    private readonly push: PushService
  ) {}

  private roleOf(c: { buyerId: string; sellerId: string }, userId: string): Role | null {
    if (c.buyerId === userId) return 'buyer';
    if (c.sellerId === userId) return 'seller';
    return null;
  }

  // «Написать» по объявлению: находит существующий диалог или создаёт новый.
  async open(userId: string, adId: string) {
    await assertNotBlocked(this.prisma, userId);
    const ad = await this.prisma.ad.findUnique({
      where: { id: adId },
      select: {
        title: true,
        authorId: true,
        status: true,
        photos: { orderBy: { order: 'asc' }, take: 1, select: { url: true } }
      }
    });
    if (!ad || ad.status !== AdStatus.approved) throw new NotFoundException('Объявление недоступно');
    if (ad.authorId === userId) throw new BadRequestException('Нельзя написать самому себе');

    const conv = await this.prisma.conversation.upsert({
      where: { adId_buyerId: { adId, buyerId: userId } },
      update: {},
      create: {
        adId,
        adTitle: ad.title,
        adPhoto: ad.photos[0]?.url ?? null,
        buyerId: userId,
        sellerId: ad.authorId
      },
      select: { id: true }
    });
    return conv;
  }

  // Диалоги без единого сообщения не показываем: «Написать» создаёт диалог заранее,
  // и продавец видел бы пустые переписки.
  async list(userId: string) {
    const convs = await this.prisma.conversation.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }], messages: { some: {} } },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      include: {
        buyer: PERSON,
        seller: PERSON,
        ad: { select: { price: true, status: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { text: true, senderId: true, createdAt: true }
        }
      }
    });

    return Promise.all(
      convs.map(async (c) => {
        const role = this.roleOf(c, userId) as Role;
        const lastRead = role === 'buyer' ? c.buyerLastReadAt : c.sellerLastReadAt;
        const unread = await this.prisma.message.count({
          where: {
            conversationId: c.id,
            senderId: { not: userId },
            ...(lastRead ? { createdAt: { gt: lastRead } } : {})
          }
        });
        return {
          id: c.id,
          role,
          ad: this.adView(c),
          other: role === 'buyer' ? c.seller : c.buyer,
          lastMessage: c.messages[0] ?? null,
          unread
        };
      })
    );
  }

  async unreadCount(userId: string) {
    return { count: await countUnreadMessages(this.prisma, userId) };
  }

  // after — ISO-время последнего полученного сообщения: для опроса отдаём только новые.
  async messages(userId: string, conversationId: string, after?: string) {
    const c = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { buyer: PERSON, seller: PERSON, ad: { select: { price: true, status: true } } }
    });
    const role = c && this.roleOf(c, userId);
    // Для чужого диалога — тот же 404, что и для несуществующего: не раскрываем, что он есть.
    if (!c || !role) throw new NotFoundException('Диалог не найден');

    let afterDate: Date | null = null;
    if (after) {
      afterDate = new Date(after);
      if (isNaN(afterDate.getTime())) throw new BadRequestException('after: invalid date');
    }

    const select = { id: true, senderId: true, text: true, createdAt: true };
    const messages = afterDate
      ? await this.prisma.message.findMany({
          where: { conversationId, createdAt: { gt: afterDate } },
          orderBy: { createdAt: 'asc' },
          take: 100,
          select
        })
      : (
          await this.prisma.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'desc' },
            take: 200,
            select
          })
        ).reverse();

    const lastRead = role === 'buyer' ? c.buyerLastReadAt : c.sellerLastReadAt;
    const hasUnread = messages.some(
      (m) => m.senderId !== userId && (!lastRead || m.createdAt > lastRead)
    );
    if (hasUnread) {
      await this.prisma.conversation.update({
        where: { id: c.id },
        data: role === 'buyer' ? { buyerLastReadAt: new Date() } : { sellerLastReadAt: new Date() }
      });
    }

    return {
      conversation: {
        id: c.id,
        role,
        ad: this.adView(c),
        other: role === 'buyer' ? c.seller : c.buyer
      },
      messages
    };
  }

  async send(userId: string, conversationId: string, rawText: string) {
    await assertNotBlocked(this.prisma, userId);
    const text = rawText.trim();
    if (!text) throw new BadRequestException('Пустое сообщение');

    const who = { select: { id: true, name: true, email: true, notifyEmail: true } };
    const c = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { buyer: who, seller: who }
    });
    const role = c && this.roleOf(c, userId);
    if (!c || !role) throw new NotFoundException('Диалог не найден');

    const sender = role === 'buyer' ? c.buyer : c.seller;
    const recipient = role === 'buyer' ? c.seller : c.buyer;
    const recipientLastRead = role === 'buyer' ? c.sellerLastReadAt : c.buyerLastReadAt;

    // Письмо — только на первое непрочитанное, иначе переписка превратится в поток писем.
    const alreadyUnread = await this.prisma.message.count({
      where: {
        conversationId,
        senderId: userId,
        ...(recipientLastRead ? { createdAt: { gt: recipientLastRead } } : {})
      }
    });

    const now = new Date();
    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: { conversationId, senderId: userId, text },
        select: { id: true, senderId: true, text: true, createdAt: true }
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: now,
          ...(role === 'buyer' ? { buyerLastReadAt: now } : { sellerLastReadAt: now })
        }
      })
    ]);

    // Пуш — на каждое сообщение, но одно уведомление на диалог (tag): новое заменяет прошлое.
    this.push.sendToUser(recipient.id, {
      title: sender.name || 'Новое сообщение',
      body: text.length > 140 ? `${text.slice(0, 140)}…` : text,
      url: `/messages?chat=${c.id}`,
      tag: `chat-${c.id}`
    });

    if (alreadyUnread === 0 && recipient.notifyEmail && recipient.email) {
      this.email
        .sendNewMessage({
          to: recipient.email,
          senderName: sender.name,
          adTitle: c.adTitle,
          preview: text,
          url: `${SITE_URL}/messages?chat=${c.id}`
        })
        .catch((err) => this.logger.warn(`Письмо о сообщении не ушло: ${(err as Error).message}`));
    }

    return message;
  }

  private adView(c: {
    adId: string | null;
    adTitle: string;
    adPhoto: string | null;
    ad: { price: number; status: AdStatus } | null;
  }) {
    return {
      id: c.adId,
      title: c.adTitle,
      photo: c.adPhoto,
      price: c.ad?.price ?? null,
      available: c.ad?.status === AdStatus.approved
    };
  }
}
