import { compressCanvasToDataUrl } from './image-utils.ts';

export function buildCleanSvgMarkup(
  svgEl: SVGSVGElement,
  logicalWidth: number,
  logicalHeight: number,
): string {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(logicalWidth));
  clone.setAttribute('height', String(logicalHeight));
  clone.setAttribute('viewBox', `0 0 ${logicalWidth} ${logicalHeight}`);
  clone.removeAttribute('class');
  clone.removeAttribute('style');

  const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bgRect.setAttribute('x', '0');
  bgRect.setAttribute('y', '0');
  bgRect.setAttribute('width', String(logicalWidth));
  bgRect.setAttribute('height', String(logicalHeight));
  bgRect.setAttribute('fill', '#ffffff');
  clone.insertBefore(bgRect, clone.firstChild);

  const serializer = new XMLSerializer();
  return serializer.serializeToString(clone);
}

export async function renderMindMapSvgToCanvas(
  svgEl: SVGSVGElement,
  logicalWidth: number,
  logicalHeight: number,
  scale = 2,
): Promise<HTMLCanvasElement> {
  const svgMarkup = buildCleanSvgMarkup(svgEl, logicalWidth, logicalHeight);
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('無法將心智圖轉繪為圖片格式。'));
    el.src = svgDataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(logicalWidth * scale));
  canvas.height = Math.max(1, Math.round(logicalHeight * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('瀏覽器無法建立圖片畫布。');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function renderMindMapSvgToBlob(
  svgEl: SVGSVGElement,
  logicalWidth: number,
  logicalHeight: number,
  format: 'png' | 'jpeg',
  scale = 2,
): Promise<Blob> {
  const canvas = await renderMindMapSvgToCanvas(svgEl, logicalWidth, logicalHeight, scale);
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const quality = format === 'jpeg' ? 0.94 : undefined;

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('心智圖圖片轉換失敗。'));
          return;
        }
        resolve(blob);
      },
      mime,
      quality,
    );
  });
}

export async function renderMindMapSvgToCompressedDataUrl(
  svgEl: SVGSVGElement,
  logicalWidth: number,
  logicalHeight: number,
): Promise<string> {
  const canvas = await renderMindMapSvgToCanvas(svgEl, logicalWidth, logicalHeight, 2);
  const { dataUrl } = compressCanvasToDataUrl(canvas, { maxWidth: 1120 });
  return dataUrl;
}
