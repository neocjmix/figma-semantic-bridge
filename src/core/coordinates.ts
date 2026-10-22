import { RectSchema, type Rect } from '../shared/contracts.js';

export interface Point { x: number; y: number }
export interface ImageGeometry { bounds: Rect; width: number; height: number }
export interface DisplayRect { left: number; top: number; width: number; height: number }

function point(value: Point): void {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new Error('Point coordinates must be finite.');
}
function size(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Image/display dimensions must be finite and positive.');
}
function geometry(value: ImageGeometry): void {
  RectSchema.parse(value.bounds);
  size(value.width, value.height);
}

/** Preview pixels and Figma absolute document coordinates are distinct spaces. */
export function documentToImage(value: Point, image: ImageGeometry): Point {
  point(value); geometry(image);
  return { x: (value.x - image.bounds.x) * image.width / image.bounds.width, y: (value.y - image.bounds.y) * image.height / image.bounds.height };
}
export function imageToDocument(value: Point, image: ImageGeometry): Point {
  point(value); geometry(image);
  return { x: image.bounds.x + value.x * image.bounds.width / image.width, y: image.bounds.y + value.y * image.bounds.height / image.height };
}
/** display must be the rendered image element's actual bounding rect after pan/zoom. */
export function clientToDocument(value: Point, display: DisplayRect, bounds: Rect): Point {
  point(value); point({ x: display.left, y: display.top }); size(display.width, display.height); RectSchema.parse(bounds);
  return imageToDocument({ x: value.x - display.left, y: value.y - display.top }, { bounds, width: display.width, height: display.height });
}
export function documentRectToImage(value: Rect, image: ImageGeometry): Rect {
  RectSchema.parse(value); const p = documentToImage(value, image);
  return { ...p, width: value.width * image.width / image.bounds.width, height: value.height * image.height / image.bounds.height };
}
export function imageRectToDocument(value: Rect, image: ImageGeometry): Rect {
  RectSchema.parse(value); const p = imageToDocument(value, image);
  return { ...p, width: value.width * image.bounds.width / image.width, height: value.height * image.bounds.height / image.height };
}
