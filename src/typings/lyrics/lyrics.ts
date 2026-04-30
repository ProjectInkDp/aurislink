export interface LyricsLine {
  text:     string
  time:     number
  duration: number
}

export interface LyricsData {
  name:      string
  synced:    boolean
  lines:     LyricsLine[]
  language?: { requested: string | null; resolved: string | null; type?: string }
}

export type LyricsResult =
  | { loadType: 'lyrics'; data: LyricsData }
  | { loadType: 'empty';  data: Record<string, never> }
  | { loadType: 'error';  data: { message: string; severity: string } }
