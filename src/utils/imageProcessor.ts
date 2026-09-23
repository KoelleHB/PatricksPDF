import { TransparencyOptions } from '../types';

export interface ProcessedImageResult {
  transparentDataUrl: string;
  pngBytes: Uint8Array;
  width: number;
  height: number;
  aspectRatio: number;
}

/**
 * Loads an image from a Data URL, Object URL, or File into an HTMLImageElement
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error('Failed to load image: ' + err));
    img.src = src;
  });
}

/**
 * Converts a Blob to a Uint8Array
 */
export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Converts canvas to PNG Blob
 */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas toBlob failed'));
    }, 'image/png');
  });
}

/**
 * Detects if an image source already contains transparency (e.g. transparent PNG or WebP)
 */
export async function detectImageHasTransparency(imageSource: string): Promise<boolean> {
  try {
    const img = await loadImage(imageSource);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;

    // Downscale for fast detection
    canvas.width = Math.min(img.naturalWidth || img.width, 300);
    canvas.height = Math.min(img.naturalHeight || img.height, 300);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    let transparentPixelsCount = 0;
    // Check alpha values
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 240) {
        transparentPixelsCount++;
        // If more than 0.5% of pixels have transparency, consider it already transparent
        if (transparentPixelsCount > 20) {
          return true;
        }
      }
    }
    return false;
  } catch (e) {
    console.warn('Failed to detect image transparency:', e);
    return false;
  }
}

/**
 * Inserts an image as-is, preserving its original pixel colors and native transparency.
 */
export async function processAsIsImage(
  imageSource: string,
  autoCrop: boolean = false
): Promise<ProcessedImageResult> {
  const img = await loadImage(imageSource);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get canvas context');

  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;

  // Max dimension limit to keep mobile memory optimal while retaining crisp quality
  const maxDim = 2000;
  if (canvas.width > maxDim || canvas.height > maxDim) {
    const scale = maxDim / Math.max(canvas.width, canvas.height);
    canvas.width = Math.round(canvas.width * scale);
    canvas.height = Math.round(canvas.height * scale);
  }

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let finalCanvas = canvas;

  // Optional auto-crop: trims outer transparent margins
  if (autoCrop) {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = 0;
    let maxY = 0;
    let hasVisiblePixel = false;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha > 15) {
        hasVisiblePixel = true;
        const pixelIndex = i / 4;
        const px = pixelIndex % canvas.width;
        const py = Math.floor(pixelIndex / canvas.width);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }

    if (hasVisiblePixel && maxX > minX && maxY > minY) {
      const padding = 8;
      const cropX = Math.max(0, minX - padding);
      const cropY = Math.max(0, minY - padding);
      const cropW = Math.min(canvas.width - cropX, maxX - minX + padding * 2);
      const cropH = Math.min(canvas.height - cropY, maxY - minY + padding * 2);

      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = cropW;
      croppedCanvas.height = cropH;
      const cropCtx = croppedCanvas.getContext('2d');
      if (cropCtx) {
        cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        finalCanvas = croppedCanvas;
      }
    }
  }

  const transparentDataUrl = finalCanvas.toDataURL('image/png');
  const blob = await canvasToBlob(finalCanvas);
  const pngBytes = await blobToUint8Array(blob);

  return {
    transparentDataUrl,
    pngBytes,
    width: finalCanvas.width,
    height: finalCanvas.height,
    aspectRatio: finalCanvas.width / finalCanvas.height,
  };
}

/**
 * Removes white background from a signature JPG/PNG and returns a transparent PNG.
 * Preserves any existing transparency in the source image.
 */
export async function removeWhiteBackground(
  imageSource: string,
  options: TransparencyOptions
): Promise<ProcessedImageResult> {
  // If user requested "as-is" mode, bypass white removal completely
  if (options.mode === 'as-is') {
    return processAsIsImage(imageSource, options.autoCrop);
  }

  const img = await loadImage(imageSource);

  // Step 1: Draw to raw canvas
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get canvas context');

  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;

  // Max dimension limit to keep mobile memory optimal while retaining crisp quality
  const maxDim = 1600;
  if (canvas.width > maxDim || canvas.height > maxDim) {
    const scale = maxDim / Math.max(canvas.width, canvas.height);
    canvas.width = Math.round(canvas.width * scale);
    canvas.height = Math.round(canvas.height * scale);
  }

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;

  const threshold = Math.max(10, Math.min(254, options.threshold));
  const feather = Math.max(0, options.feather);

  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = 0;
  let maxY = 0;
  let hasInkPixels = false;

  for (let i = 0; i < data.length; i += 4) {
    const origAlpha = data[i + 3];

    // CRITICAL: If the pixel in the source image is already transparent,
    // preserve it as transparent! Never convert transparent pixels (RGB 0,0,0) into solid black.
    if (origAlpha <= 10) {
      data[i + 3] = 0;
      continue;
    }

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Calculate perceptual luminance
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    // Determine transparency
    let calculatedAlpha: number;

    if (lum >= threshold) {
      if (feather > 0) {
        // Smooth dropoff between threshold - feather and 255
        const span = 255 - threshold + feather;
        const normalized = Math.max(0, 255 - lum);
        calculatedAlpha = Math.floor((normalized / span) * 255);
        if (calculatedAlpha < 8) calculatedAlpha = 0;
      } else {
        calculatedAlpha = 0;
      }
    } else {
      if (feather > 0 && lum > threshold - feather) {
        // Transition region
        const ratio = (threshold - lum) / feather;
        calculatedAlpha = Math.min(255, Math.floor(180 + ratio * 75));
      } else {
        calculatedAlpha = 255;
      }
    }

    // Never make a pixel more opaque than its original alpha
    const alpha = Math.min(origAlpha, calculatedAlpha);

    // Apply Ink Enhancement
    if (alpha > 0) {
      hasInkPixels = true;
      const pixelIndex = i / 4;
      const px = pixelIndex % canvas.width;
      const py = Math.floor(pixelIndex / canvas.width);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;

      if (options.inkMode === 'darken') {
        // Boost contrast and deepen ink
        const darkenFactor = 0.65;
        data[i] = Math.max(0, Math.floor(r * darkenFactor));
        data[i + 1] = Math.max(0, Math.floor(g * darkenFactor));
        data[i + 2] = Math.max(0, Math.floor(b * darkenFactor));
      } else if (options.inkMode === 'black-ink') {
        // Deep pure rich black
        const inkIntensity = 1 - lum / 255;
        const darkness = Math.floor(25 * (1 - inkIntensity));
        data[i] = darkness;
        data[i + 1] = darkness;
        data[i + 2] = darkness;
      } else if (options.inkMode === 'blue-ink') {
        // Legal document blue ink (#1d4ed8 / #1e40af)
        const inkIntensity = Math.min(1, Math.max(0, (255 - lum) / 200));
        data[i] = Math.floor(20 + (1 - inkIntensity) * 40);
        data[i + 1] = Math.floor(50 + (1 - inkIntensity) * 60);
        data[i + 2] = Math.floor(180 + (1 - inkIntensity) * 40);
      }
    }

    data[i + 3] = alpha;
  }

  ctx.putImageData(imgData, 0, 0);

  // Auto-crop if requested and ink was found
  let finalCanvas = canvas;
  if (options.autoCrop && hasInkPixels && maxX > minX && maxY > minY) {
    const padding = 12;
    const cropX = Math.max(0, minX - padding);
    const cropY = Math.max(0, minY - padding);
    const cropW = Math.min(canvas.width - cropX, maxX - minX + padding * 2);
    const cropH = Math.min(canvas.height - cropY, maxY - minY + padding * 2);

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cropW;
    croppedCanvas.height = cropH;
    const cropCtx = croppedCanvas.getContext('2d');
    if (cropCtx) {
      cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      finalCanvas = croppedCanvas;
    }
  }

  const transparentDataUrl = finalCanvas.toDataURL('image/png');
  const blob = await canvasToBlob(finalCanvas);
  const pngBytes = await blobToUint8Array(blob);

  return {
    transparentDataUrl,
    pngBytes,
    width: finalCanvas.width,
    height: finalCanvas.height,
    aspectRatio: finalCanvas.width / finalCanvas.height,
  };
}
