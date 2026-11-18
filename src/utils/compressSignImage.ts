const MAX_IMAGE_DIMENSION = 512;
const IMAGE_QUALITY = 0.8;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read the selected image."));
    };
    image.src = objectUrl;
  });
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  mimeType: string,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not compress the selected image."));
      },
      mimeType,
      IMAGE_QUALITY,
    );
  });
}

export async function compressSignImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  const image = await loadImage(file);
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error("The selected image has invalid dimensions.");
  }
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / image.naturalWidth,
    MAX_IMAGE_DIMENSION / image.naturalHeight,
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image compression is not supported by this browser.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let blob = await encodeCanvas(canvas, "image/webp");
  if (blob.type !== "image/webp") {
    blob = await encodeCanvas(canvas, "image/jpeg");
  }
  const extension = blob.type === "image/webp" ? "webp" : "jpg";
  const name = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${name}.${extension}`, {
    type: blob.type,
    lastModified: file.lastModified,
  });
}
