export const MAX_IMAGE_DATA_URL_CHARS = 38000;
export const MAX_NOTE_CONTENT_CHARS = 100000;

export function isSafeImageSource(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed) return false;
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('無法載入圖片檔案，請確認格式是否為 PNG、JPG、WebP 或 GIF。'));
    img.src = src;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('圖片讀取失敗'));
      }
    };
    reader.onerror = () => reject(new Error('無法讀取圖片檔案'));
    reader.readAsDataURL(file);
  });
}

export function compressCanvasToDataUrl(
  sourceCanvas: HTMLCanvasElement,
  options: { maxWidth?: number; maxChars?: number } = {},
): { dataUrl: string; width: number; height: number } {
  const maxWidthInitial = options.maxWidth ?? 960;
  const maxChars = options.maxChars ?? MAX_IMAGE_DATA_URL_CHARS;
  const naturalW = sourceCanvas.width || 800;
  const naturalH = sourceCanvas.height || 600;

  const widthSteps = [maxWidthInitial, 840, 720, 560, 420].filter(
    (w, idx, arr) => arr.indexOf(w) === idx,
  );
  const qualitySteps = [0.85, 0.72, 0.58, 0.44];

  for (const targetMaxW of widthSteps) {
    const scale = naturalW > targetMaxW ? targetMaxW / naturalW : 1;
    const width = Math.max(1, Math.round(naturalW * scale));
    const height = Math.max(1, Math.round(naturalH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('瀏覽器無法建立圖片壓縮畫布。');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(sourceCanvas, 0, 0, width, height);

    const pngCandidate = canvas.toDataURL('image/png');
    if (pngCandidate.startsWith('data:image/png') && pngCandidate.length <= maxChars) {
      return { dataUrl: pngCandidate, width, height };
    }

    for (const quality of qualitySteps) {
      const candidate = canvas.toDataURL('image/jpeg', quality);
      if (candidate.startsWith('data:image/jpeg') && candidate.length <= maxChars) {
        return { dataUrl: candidate, width, height };
      }
    }
  }

  throw new Error('圖片壓縮後仍過大，請改用解析度較低的圖片或貼上外部圖片網址。');
}

export async function compressImageFileToDataUrl(
  file: File,
  options: { maxWidth?: number; maxChars?: number } = {},
): Promise<{ dataUrl: string; width: number; height: number }> {
  const maxWidthInitial = options.maxWidth ?? 960;
  const maxChars = options.maxChars ?? MAX_IMAGE_DATA_URL_CHARS;

  if (!file.type.startsWith('image/')) {
    throw new Error('請選擇圖片檔案（PNG、JPG、WebP 或 GIF）。');
  }
  if (file.type === 'image/svg+xml') {
    throw new Error('基於安全考量，不支援嵌入 SVG 檔案，請改用 PNG、JPG 或 WebP 圖片。');
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('原始圖片超過 15 MB，請選擇較小的圖片檔案。');
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadImageElement(rawDataUrl);

  const naturalW = img.naturalWidth || img.width || 800;
  const naturalH = img.naturalHeight || img.height || 600;

  if (file.type === 'image/gif' && rawDataUrl.length <= maxChars) {
    return { dataUrl: rawDataUrl, width: naturalW, height: naturalH };
  }

  const canvas = document.createElement('canvas');
  canvas.width = naturalW;
  canvas.height = naturalH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('瀏覽器無法建立圖片壓縮畫布。');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, naturalW, naturalH);
  ctx.drawImage(img, 0, 0, naturalW, naturalH);

  return compressCanvasToDataUrl(canvas, { maxWidth: maxWidthInitial, maxChars });
}

export async function convertLegacyWebpImagesInMarkdown(content: string): Promise<string> {
  if (typeof document === 'undefined' || !content.includes('data:image/webp;base64,')) {
    return content;
  }

  const matches = content.match(/data:image\/webp;base64,[A-Za-z0-9+/=]+/gi);
  if (!matches || matches.length === 0) {
    return content;
  }

  const uniqueWebpUrls = Array.from(new Set(matches));
  const perImageBudget = Math.max(
    8000,
    Math.min(MAX_IMAGE_DATA_URL_CHARS, Math.floor(85000 / uniqueWebpUrls.length)),
  );

  const replacements = new Map<string, string>();

  for (const webpUrl of uniqueWebpUrls) {
    try {
      const img = await loadImageElement(webpUrl);
      const naturalW = img.naturalWidth || img.width || 800;
      const naturalH = img.naturalHeight || img.height || 600;
      const canvas = document.createElement('canvas');
      canvas.width = naturalW;
      canvas.height = naturalH;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, naturalW, naturalH);
      ctx.drawImage(img, 0, 0, naturalW, naturalH);
      const { dataUrl } = compressCanvasToDataUrl(canvas, {
        maxWidth: 960,
        maxChars: perImageBudget,
      });
      replacements.set(webpUrl, dataUrl);
    } catch {
      // Leave original URL if decoding fails in browser
    }
  }

  if (replacements.size === 0) {
    return content;
  }

  return content.replace(/data:image\/webp;base64,[A-Za-z0-9+/=]+/gi, (matched) => {
    return replacements.get(matched) ?? matched;
  });
}
