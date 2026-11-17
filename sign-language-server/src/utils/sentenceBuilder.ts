export class FrameBuffer {
  private frames: any[] = [];
  private readonly capacity: number;
  constructor(capacity: number = 20) {
    this.capacity = capacity;
  }
  push(features: any) {
    this.frames.push(features);
    if (this.frames.length > this.capacity) {
      this.frames.shift();
    }
  }
  snapshot(): any[] {
    return [...this.frames];
  }
  get length(): number {
    return this.frames.length;
  }
  clear() {
    this.frames = [];
  }
}
