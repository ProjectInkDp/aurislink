import type { LyricsResult, LyricsLine } from './lyrics.js';

export interface CacheEntry<T = LyricsResult> {
  value:   T
  expires: number
}

export interface FetchedLyrics {
  trackId?:   number
  subtitleId?: number
  lyrics?:    string | null
  subtitle?:  string
  subtitles?: LyricsLine[] | null
  track?:     MxmTrackItem | Record<string, never>
}

export interface FormattedLyrics {
  name?:  string
  synced: boolean
  lines:  LyricsLine[]
}

export interface MxmMacroBody {
  macro_calls?: {
    'matcher.track.get'?: { message?: { body?: { track?: MxmTrack } } }
    'track.lyrics.get'?:  { message?: { body?: { lyrics?: { lyrics_body?: string } } } }
    'track.subtitles.get'?: { message?: { body?: { subtitle_list?: Array<{ subtitle?: { subtitle_id?: number; subtitle_body?: string } }> } } }
  }
}

export interface MxmParsedSubtitleItem {
  text:  string
  time:  { total: number; duration?: number }
}

export interface MxmSearchBody {
  message?: {
    body?: {
      track_list?: Array<{ track?: MxmTrackItem }>
    }
  }
  track_list?: Array<{ track?: MxmTrackItem }>
}

export interface MxmTrack {
  track_id?:       number
  track_name?:     string
  artist_name?:    string
  has_lyrics?:     number
  has_subtitles?:  number
}

export interface MxmTrackItem {
  track_id?:       number
  track_name?:     string
  artist_name?:    string
  has_lyrics?:     number
  has_subtitles?:  number
  num_favourite?:  number
  track_rating?:   number
}

export interface AurisInstanceForMusixmatch {
  options: {
    lyrics?: {
      musixmatch?: {
        signatureSecret?: string
      }
    }
    [key: string]: unknown
  }
  credentialManager: {
    get(key: string): string | null
    set(key: string, value: string, ttl?: number): void
  }
}

export interface ScoredTrack {
  track: MxmTrackItem
  score: number
}

export interface TokenData {
  value:   string
  expires: number
  token?:  string
  expiresAt?: number
}
