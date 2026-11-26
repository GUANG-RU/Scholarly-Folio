export type CourseRefItem = {
  id: string;
  noteId: string;
  type: 'COURSE' | 'PAPER';
  title: string;
  provider: 'MIT_OCW' | 'CURATED_OCW' | 'OPENALEX';
  summary: string;
  url: string;
  createdAt: string;
};

export type TopicItem = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isSystemInbox: boolean;
  createdAt: string;
};

export type NoteItem = {
  id: string;
  topicId: string;
  title: string;
  content: string;
  status: 'DRAFT' | 'ARCHIVED';
  tags: string[];
  summary: string;
  createdAt: string;
  updatedAt: string;
  courseRefs: CourseRefItem[];
};

export type ShareBundleItem = {
  id: string;
  slug: string;
  title: string;
  createdAt: string;
};

export type CourseSearchResultItem = {
  externalId: string;
  type: 'COURSE' | 'PAPER';
  title: string;
  provider: 'MIT_OCW' | 'CURATED_OCW' | 'OPENALEX';
  summary: string;
  url: string;
};

export type PublicShareBundle = {
  slug: string;
  title: string;
  createdAt: string;
  notes: Array<{
    id: string;
    title: string;
    content: string;
    tags: string[];
    summary: string;
    updatedAt: string;
    courseRefs: Array<{
      id: string;
      type: 'COURSE' | 'PAPER';
      title: string;
      provider: 'MIT_OCW' | 'CURATED_OCW' | 'OPENALEX';
      summary: string;
      url: string;
    }>;
  }>;
};

export type DriveExportFormat = 'docx' | 'gdoc' | 'md' | 'txt' | 'zip';

export type DriveFolderItem = {
  id: string;
  name: string;
  parents?: string[];
  modifiedTime?: string;
};

export type DriveUploadedFileItem = {
  id: string;
  name: string;
  folderId: string;
  webViewLink?: string;
  mimeType: string;
};

export type DriveReadableFileItem = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
};

export type ImportedDocumentPreview = {
  title: string;
  content: string;
  truncated: boolean;
  charCount: number;
  formatLabel: string;
  sourceKind: 'local' | 'drive';
  sourceName: string;
  webViewLink?: string;
};

export type ImportedReferenceDoc = {
  title: string;
  content: string;
  sourceLabel: string;
  webViewLink?: string;
};

export type MindMapBranchColor = 'blue' | 'emerald' | 'amber' | 'rose' | 'violet';

export type MindMapNode = {
  id: string;
  label: string;
  detail?: string;
  color: MindMapBranchColor;
  children: MindMapNode[];
};

export type MindMapResult = {
  root: MindMapNode;
  nodeCount: number;
};

