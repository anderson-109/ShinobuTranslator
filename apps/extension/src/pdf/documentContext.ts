import type { PipelineRecord } from '@shinobu/image-pipeline';
import type { TranslationReferenceContext } from '@shinobu/text-translation';

type DocumentContext = Extract<TranslationReferenceContext, { source: 'pdf_document' }>;
export class DocumentTranslationMemory {
  private readonly pages = new Map<number, DocumentContext['previousTranslations'][number]>();
  remember(pageNumber: number, record: PipelineRecord): void {
    const ordered = [...record.translations].sort((a, b) => a.order - b.order);
    const sourceText = (ordered.length ? ordered.map((item) => item.sourceText) : [...record.ocr].sort((a, b) => a.order - b.order).map((item) => item.text)).join('\n').slice(0, 1500);
    const translatedText = ordered.map((item) => item.translatedText).join('\n').slice(0, 1500);
    if (!sourceText && !translatedText) return;
    this.pages.set(pageNumber, { pageNumber, sourceText, translatedText });
    if (this.pages.size > 16) this.pages.delete(this.pages.keys().next().value!);
  }
  context(pageNumber: number, currentPageText = '', previousPageText = '', nextPageText = ''): DocumentContext {
    return { source: 'pdf_document', pageNumber, currentPageText: currentPageText.slice(0, 4000),
      previousPageText: previousPageText.slice(0, 2000), nextPageText: nextPageText.slice(0, 2000),
      previousTranslations: [...this.pages.values()].filter((page) => page.pageNumber < pageNumber)
        .sort((a, b) => a.pageNumber - b.pageNumber).slice(-3) };
  }
}
