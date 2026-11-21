export type VideoStatus =
  | "saved"
  | "queued"
  | "extracting"
  | "indexing"
  | "summarizing"
  | "ready"
  | "needs_transcript"
  | "failed";

export type SourceType = "youtube" | "x" | "reddit" | "web" | "image" | "note" | "pdf" | "palette" | "audio";

export type KeyPoint = { text: string; startSeconds: number | null };

export type SummarySection = {
  title: string;
  points: KeyPoint[];
};

export type Summary = {
  gist: string;
  // Título descriptivo escrito por la IA (para tweets, capturas y páginas sin un título útil).
  headline?: string;
  originalTitle?: string;
  cardSummary?: string;
  sourceTranslation?: string;
  sections?: SummarySection[];
  keyPoints: KeyPoint[];
  chapters: Array<{ title: string; startSeconds: number; summary: string }>;
  takeaways: string[];
};

export type Citation = {
  startSeconds: number;
  endSeconds: number;
  label: string;
  text: string;
  videoId?: string;
  videoTitle?: string;
  videoUrl?: string;
  sourceType?: SourceType;
  sourceKind?: "transcript" | "summary" | "note";
  sourceItemId?: string;
  sourceItemUrl?: string;
  // Número [S n] con el que la IA citó este fragmento (para dibujar las citas numeradas).
  ref?: number;
};

export type SourceItem = {
  id: string;
  externalId: string;
  ordinal: number;
  url: string;
  authorName: string;
  authorHandle: string;
  text: string;
  publishedAt: string;
  previewUrl: string;
  metadata?: {
    heading?: string;
    siteName?: string;
    sourceKind?: "substack" | "web" | "product" | "movie";
    product?: { price: string; currency: string; brand: string };
    movie?: { kind: "movie" | "series"; name: string; year: string; duration: string; director: string; rating: string; poster: string; synopsis: string };
    language?: string;
    faviconUrl?: string;
    avatarUrl?: string;
    page?: number;
    pageCount?: number;
    ocr?: boolean;
    truncated?: boolean;
    depth?: number;
    kind?: "post" | "thread" | "comment" | "reply";
    parentTitle?: string;
    parentUrl?: string;
    capturedBy?: string;
    wordCount?: number;
  };
};

export type LibraryCollection = {
  id: string;
  name: string;
  color: string;
  description?: string;
  parentId: string | null;
  sortOrder: number;
  updatedAt?: string;
};

export type LibraryTag = {
  id: string;
  catalogKey: string;
  name: string;
  color: string;
  level: "primary" | "secondary" | "free";
  parentIds: string[];
  sortOrder: number;
  active: boolean;
};

export type ChatScopeType = "video" | "collection" | "tag" | "selection";

export type ChatSourceSelection = {
  collectionIds: string[];
  tagIds: string[];
  videoIds: string[];
  excludedVideoIds: string[];
};

export type ConversationSummary = {
  id: string;
  title: string;
  preview: string;
  scopeType: ChatScopeType;
  scopeLabel: string;
  sourceCount: number;
  updatedAt: string;
  pinnedAt: string | null;
};

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  modelId: AvailableModel["id"];
  createdAt: string;
};

export type ConversationTurnStatus = "queued" | "generating" | "complete" | "failed";

export type ConversationTurn = {
  id: string;
  userMessageId: string;
  assistantMessageId: string | null;
  status: ConversationTurnStatus;
  error: string;
  modelId: AvailableModel["id"];
};

export type AvailableModel = {
  id: "auto" | "gemini" | "openai";
  label: string;
  provider: "auto" | "gemini" | "openai";
  description: string;
};

export type KnowledgeEntity = {
  name: string;
  type: "person" | "organization" | "tool" | "place" | "concept" | "idea";
  description: string;
  evidenceTimestamp: number;
};

export type KnowledgeRelation = {
  sourceName: string;
  targetName: string;
  relationType: string;
  explanation: string;
  evidenceTimestamp: number;
};

export type GraphNodeData = {
  id: string;
  nodeType: "video" | "collection" | "tag" | "person" | "organization" | "tool" | "place" | "concept" | "idea";
  refId: string | null;
  label: string;
  description: string;
  metadata: Record<string, unknown>;
  degree: number;
};

export type GraphEdgeData = {
  id: string;
  source: string;
  target: string;
  relationType: string;
  origin: "manual" | "membership" | "tag" | "ai" | "semantic";
  confidence: number;
  status: "suggested" | "confirmed" | "hidden";
  explanation: string;
};

export type TranscriptCue = {
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type AppVideo = {
  id: string;
  youtubeId: string;
  sourceType: SourceType;
  sourcePublishedAt: string;
  url: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
  durationSeconds: number;
  description: string;
  sourceLanguage: string;
  status: VideoStatus;
  summary: Summary | null;
  transcriptSource: string;
  error: string;
  highlights?: Highlight[];
  visual?: VisualAnalysis | null;
  archivedAt?: string | null;
  resurfacedAt?: string | null;
  consumedAt?: string | null;
  snapshotSavedAt?: string | null;
  linkStatus?: string | null;
  topPosition?: number | null;
  createdAt: string;
  updatedAt: string;
  addedByName: string;
  tags: LibraryTag[];
  collections: Array<{ id: string; name: string; color: string }>;
  note: { content: string; updatedAt: string; updatedByName: string } | null;
  sourceItems: SourceItem[];
  threadStatus: "single" | "complete" | "partial";
};

export type SmartSpace = {
  id: string;
  name: string;
  color: string;
  query: string;
  createdAt: string;
  itemIds: string[];
};

export type Highlight = {
  id: string;
  videoId: string;
  quote: string;
  note: string;
  origin: "reader" | "clip";
  createdAt: string;
};

export type VisualAnalysis = {
  text: string;
  labels: Array<{ id: string; name: string; confidence: number }>;
  colors: Array<{ hex: string; share: number }>;
  width: number;
  height: number;
  description: string;
  objects: string[];
  aiModel: string;
  error: string;
  hasPrint?: boolean;
};

export type NoteConnection = { id: string | null; title: string; sourceType: SourceType | null };

export type NoteVersion = { id: string; content: string; createdAt: string };

export type ReviewCard = {
  id: string;
  kind: "highlight" | "idea";
  text: string;
  note: string;
  isNew: boolean;
  intervals: { again: number; good: number; easy: number };
  video: { id: string; title: string; channel: string; sourceType: SourceType; thumbnailUrl: string };
};

export type ReviewSession = {
  cards: ReviewCard[];
  doneToday: number;
  dailyLimit: number;
  remaining: number;
  streak: number;
};
