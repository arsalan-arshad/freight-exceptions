import { formatInstant } from '../core/format';

const MIN = 60_000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function p2(n: number): string {
  return String(n).padStart(2, '0');
}

/** RFC 5322 date header, e.g. "Fri, 06 Nov 2026 14:00:00 -0500". */
function rfcDate(ms: number, offsetMin: number): string {
  const d = new Date(ms + offsetMin * MIN);
  const sign = offsetMin < 0 ? '-' : '+';
  const a = Math.abs(offsetMin);
  return `${DAYS[d.getUTCDay()]}, ${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} ${sign}${p2(Math.floor(a / 60))}${p2(a % 60)}`;
}

/** "Nov 06, 2026 6:30 PM" in the given offset (no timezone text). */
function humanLocal(ms: number, offsetMin: number): string {
  const d = new Date(ms + offsetMin * MIN);
  const h = d.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${MONTHS[d.getUTCMonth()]} ${p2(d.getUTCDate())}, ${d.getUTCFullYear()} ${h12}:${p2(d.getUTCMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "-05:00" style offset text. */
function offText(offsetMin: number): string {
  return formatInstant(0, offsetMin).slice(-6);
}

interface Mail {
  id: string;
  from: string;
  to: string;
  subject: string;
  /** Minutes before now that the message was sent. */
  sentAgo: number;
  offset: number;
  body: string[];
}

/**
 * Six obviously fake raw .eml texts (LF line endings, example.com addresses). Each mentions a
 * reference that exists in generateSampleCsv(now). Variety on purpose:
 *   msg-0001 carrier ETA with an explicit offset          (LD-7004)
 *   msg-0002 delivery confirmation with an explicit offset (LD-7012)
 *   msg-0003 POD attached note                             (LD-7005)
 *   msg-0004 invoice amount                                (LD-7010)
 *   msg-0005 a time with NO timezone                       (LD-7006)  -> must be flagged, not guessed
 *   msg-0006 nothing extractable                           (LD-7003)
 */
export function generateSampleEmails(now: Date): { id: string; raw: string }[] {
  const nowMs = now.getTime();
  const mails: Mail[] = [
    {
      id: 'msg-0001',
      from: 'Dana Dispatcher <dispatch@example.com>',
      to: 'ops@example.com',
      subject: 'RE: LD-7004 updated ETA',
      sentAgo: 40,
      offset: -300,
      body: [
        'Hi team,',
        '',
        'Heavy traffic on I-80 today. For load LD-7004 the new ETA to the receiver is',
        `${humanLocal(nowMs + 480 * MIN, -300)} (UTC${offText(-300)}). Driver will call when he is 30 minutes out.`,
        '',
        'Thanks,',
        'Dana',
        'Example Carrier LLC dispatch',
      ],
    },
    {
      id: 'msg-0002',
      from: 'Sam Driver <sam.driver@example.com>',
      to: 'ops@example.com',
      subject: 'LD-7012 delivered',
      sentAgo: 350,
      offset: -360,
      body: [
        'Load LD-7012 was delivered and unloaded without issues.',
        `Delivery completed ${humanLocal(nowMs - 360 * MIN, -360)} (UTC${offText(-360)}).`,
        'Signed POD will follow once the receiver scans it.',
        '',
        'Regards,',
        'Sample Trucking Co',
      ],
    },
    {
      id: 'msg-0003',
      from: 'Billing Desk <billing@example.com>',
      to: 'ops@example.com',
      subject: 'POD for LD-7005',
      sentAgo: 20,
      offset: 0,
      body: [
        'Hello,',
        '',
        'Sorry for the delay. The signed proof of delivery for LD-7005 is attached.',
        '',
        'Attachment: POD_LD-7005.pdf (application/pdf, 212 KB)',
        '',
        'Demo Haulers Inc',
      ],
    },
    {
      id: 'msg-0004',
      from: 'Accounts Receivable <ar@example.com>',
      to: 'ap@example.com',
      subject: 'Invoice INV-20418 for LD-7010',
      sentAgo: 90,
      offset: -480,
      body: [
        'Please find our invoice for load LD-7010.',
        '',
        'Invoice number: INV-20418',
        'Total due: $1,185.00 USD',
        'Terms: net 30',
        '',
        'Test Transport LLC',
      ],
    },
    {
      id: 'msg-0005',
      from: 'Dana Dispatcher <dispatch@example.com>',
      to: 'ops@example.com',
      subject: 'LD-7006 check call',
      sentAgo: 15,
      offset: -300,
      body: [
        'Quick update on LD-7006: the driver checked in at the receiver at 2:15 PM.',
        'Waiting on a dock door. Will update when unloading starts.',
        '',
        'Dana',
      ],
    },
    {
      id: 'msg-0006',
      from: 'Front Desk <frontdesk@example.com>',
      to: 'ops@example.com',
      subject: 'RE: LD-7003',
      sentAgo: 25,
      offset: -360,
      body: [
        'Thanks for flagging LD-7003. We are checking with dispatch and will get back to you.',
        '',
        'Example Carrier LLC',
      ],
    },
  ];

  return mails.map((m) => {
    const sentMs = nowMs - m.sentAgo * MIN;
    const raw = [
      `Message-ID: <${m.id}@mail.example.com>`,
      `Date: ${rfcDate(sentMs, m.offset)}`,
      `From: ${m.from}`,
      `To: ${m.to}`,
      `Subject: ${m.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      ...m.body,
      '',
    ].join('\n');
    return { id: m.id, raw };
  });
}
