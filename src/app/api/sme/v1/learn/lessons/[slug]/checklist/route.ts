import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/serverAuth';
import { correlationIdFrom, parseQuery } from '@/sme/api/route';
import { SmeError, fromDbError, toResponse } from '@/sme/api/errors';
import { lessonQuery } from '@/sme/content/api/schemas';
import { checklistItems, contentBodySchema } from '@/sme/content/schema';
import { checklistPdf } from '@/sme/content/server/checklistPdf';
import ar from '@/messages/ar';
import en from '@/messages/en';

const SLUG = /^[a-z0-9][a-z0-9_-]{2,120}$/;

// LRN-02: the lesson's checklist as a PDF, from the published version the reader can see.
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }): Promise<NextResponse> {
  const correlationId = correlationIdFrom(request);
  try {
    const auth = await requireUser(request);
    if ('error' in auth) return auth.error;
    const { slug } = await context.params;
    const { locale } = parseQuery(request, lessonQuery);
    if (!SLUG.test(slug)) throw new SmeError('NOT_FOUND', { field: 'slug' });
    const { data, error } = await auth.client.from('content_versions')
      .select('title, body, content_items!inner(slug)').eq('content_items.slug', slug).eq('locale', locale).eq('state', 'published').maybeSingle();
    if (error) throw fromDbError(error);
    if (!data) throw new SmeError('NOT_FOUND', { field: 'slug' });
    const body = contentBodySchema.safeParse(data.body);
    const items = body.success ? checklistItems(body.data) : [];
    if (items.length === 0) throw new SmeError('NOT_FOUND', { field: 'checklist' });
    const m = locale === 'ar' ? ar : en;
    const pdf = checklistPdf({
      title: data.title as string, subtitle: m['learn.checklist.subtitle'], doneLabel: m['learn.checklist.done'], itemLabel: m['learn.checklist.item'],
      items, isArabic: locale === 'ar',
    });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${slug}-checklist.pdf"`,
        'x-correlation-id': correlationId,
      },
    });
  } catch (err) {
    return toResponse(err, correlationId);
  }
}
