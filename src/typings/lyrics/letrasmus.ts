import type { LyricsResult } from './lyrics.js';

export interface LetrasLyricsTrackInfo {
  title:       string
  author:      string
  uri?:        string | null
  sourceName?: string
}
export type LetrasMusLyricsResult = LyricsResult
export interface LetrasOmqLyricPayload {
  ID?:           number | string
  SongLanguage?: string
  Name?:         string
}
export interface LetrasSolrDoc {
  url?:    { artist?: string; song?: string; translation?: string }
  dns?:    string
  art?:    string
  mus?:    string
  t?:      string
  txt?:    string
}
export interface LetrasSolrResponse {
  docs?:     LetrasSolrDoc[]
  response?: { docs?: LetrasSolrDoc[] }
}
export interface LetrasSubtitleApiResponse {
  start_time?: number
  end_time?:   number
  text?:       string
  status?:     string
  Original?:   { Subtitle?: string }
}
export type LetrasSubtitleRawEntry = [string, string, string]
export interface LetrasTranslationLanguageEntry {
  lang?:         string
  url?:          string | { artist?: string; song?: string; translation?: string }
  languageCode?: string
}
