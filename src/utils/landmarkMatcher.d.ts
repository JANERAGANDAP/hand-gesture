export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

export interface LandmarkTemplate {
  word: string;
  landmarks: LandmarkPoint[];
}

export interface LandmarkMatch {
  word: string;
  confidence: number;
  distance: number;
}

export function matchLandmarkTemplate(
  points: LandmarkPoint[],
  templates: LandmarkTemplate[],
  minimumConfidence?: number,
): LandmarkMatch | null;
