import { Plugin, TFile, MarkdownView, Editor, App } from "obsidian";

export interface CommentItem {
    id: string;           // 评论的唯一ID
    content: string;      // 评论内容
    createdAt: number;    // 创建时间
    updatedAt: number;    // 最后更新时间
}

export interface HighlightComment {
    id: string;           
    text: string;         
    position: number;     
    paragraphId: string;  // 新增：段落的唯一ID
    comments: CommentItem[];  
    createdAt: number;    
    updatedAt: number;    
    isVirtual?: boolean;  // 新增：是否是虚拟高亮
    filePath?: string;    // 新增：文件路径
    fileType?: string;    // 新增：文件类型
    displayText?: string; // 新增：显示文本
    paragraphOffset?: number; // 新增：段落偏移量
    backgroundColor?: string; // 新增：背景颜色
}

export interface FileComment {
    id: string;
    content: string;
    createdAt: number;
    updatedAt: number;
    filePath: string;
}

export interface FileComments {
    [highlightId: string]: HighlightComment;
}

export interface CommentsData {
    [filePath: string]: FileComments;
}

export interface FileCommentsData {
    [filePath: string]: FileComment[];
}

export class CommentStore {
    private plugin: Plugin;
    private data: CommentsData = {};
    private fileCommentsData: FileCommentsData = {};
    private comments: Map<string, HighlightComment[]> = new Map();
    private fileComments: Map<string, FileComment[]> = new Map();
    private commentCache: Map<string, HighlightComment[]> = new Map();
    private maxCacheSize: number = 100;
    private readonly PERFORMANCE_THRESHOLD = 100; // 毫秒

    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }

    async loadComments() {
        const data = await this.plugin.loadData();
        this.data = data?.comments || {};
        this.fileCommentsData = data?.fileComments || {};

        // 将 data 转换为正确的格式
        this.comments = new Map(
            Object.entries(this.data).map(([key, value]) => [
                key,
                Object.values(value as { [key: string]: HighlightComment })
            ])
        );

        this.fileComments = new Map(Object.entries(this.fileCommentsData));
    }

    async saveComments() {
        await this.plugin.saveData({
            comments: this.data,
            fileComments: Object.fromEntries(this.fileComments)
        });
    }

    getFileComments(file: TFile): HighlightComment[] {
        const comments = this.data[file.path] || {};
        // 修改排序逻辑，虚拟高亮始终在最前面
        return Object.values(comments).sort((a, b) => {
            const aIsVirtual = (a as any).isVirtual || false;
            const bIsVirtual = (b as any).isVirtual || false;
            if (aIsVirtual && !bIsVirtual) return -1;
            if (!aIsVirtual && bIsVirtual) return 1;
            return a.position - b.position;
        });
    }

    getFileOnlyComments(file: TFile): FileComment[] {
        return this.fileComments.get(file.path) || [];
    }

    async addComment(file: TFile, highlight: HighlightComment) {
        if (!this.data[file.path]) {
            this.data[file.path] = {};
        }
        
        // 如果是虚拟高亮，直接使用已有的 paragraphId
        if ((highlight as any).isVirtual) {
            this.data[file.path][highlight.id] = highlight;
            await this.saveComments();
            return;
        }

        // 确保 highlight 包含 paragraphId
        if (!highlight.paragraphId) {
            const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            const editor = view?.editor;
            const currentFile = view?.file;
            
            if (editor && currentFile) {
                const pos = editor.offsetToPos(highlight.position);
                const blockId = currentFile.path + '#^' + this.getBlockId(editor, pos.line);
                highlight.paragraphId = blockId;
            } else {
                highlight.paragraphId = file.path + '#^' + Date.now();
            }
        }

        this.data[file.path][highlight.id] = highlight;
        await this.saveComments();
    }

    async addFileComment(file: TFile, content: string): Promise<FileComment> {
        const fileComment: FileComment = {
            id: `file-comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            content,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            filePath: file.path
        };

        const comments = this.fileComments.get(file.path) || [];
        comments.push(fileComment);
        this.fileComments.set(file.path, comments);

        await this.saveComments();
        return fileComment;
    }

    async updateComment(file: TFile, highlightId: string, commentContent: string) {
        if (this.data[file.path]?.[highlightId]) {
            const highlight = this.data[file.path][highlightId];
            // 创建新的评论
            const newComment: CommentItem = {
                id: `comment-${Date.now()}`,
                content: commentContent,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            
            // 初化评论数组（如果不存在）
            if (!highlight.comments) {
                highlight.comments = [];
            }
            
            // 添加新评论
            highlight.comments.push(newComment);
            highlight.updatedAt = Date.now();
            await this.saveComments();
        }
    }

    async updateFileComment(file: TFile, commentId: string, content: string): Promise<void> {
        const comments = this.fileComments.get(file.path) || [];
        const comment = comments.find(c => c.id === commentId);
        if (comment) {
            comment.content = content;
            comment.updatedAt = Date.now();
            await this.saveComments();
        }
    }

    async removeComment(file: TFile, highlight: HighlightComment) {
        const filePath = file.path;
        if (this.data[filePath]?.[highlight.id]) {
            delete this.data[filePath][highlight.id];
            if (Object.keys(this.data[filePath]).length === 0) {
                delete this.data[filePath];
            }
            await this.saveComments();
        }
    }

    async deleteFileComment(file: TFile, commentId: string): Promise<void> {
        const comments = this.fileComments.get(file.path) || [];
        const index = comments.findIndex(c => c.id === commentId);
        if (index !== -1) {
            comments.splice(index, 1);
            if (comments.length === 0) {
                this.fileComments.delete(file.path);
            } else {
                this.fileComments.set(file.path, comments);
            }
            await this.saveComments();
        }
    }

    // 清理不存在的文件的评论
    async cleanupComments(existingFiles: Set<string>) {
        let changed = false;
        for (const filePath of Object.keys(this.data)) {
            if (!existingFiles.has(filePath)) {
                delete this.data[filePath];
                changed = true;
            }
        }
        for (const filePath of Object.keys(this.fileCommentsData)) {
            if (!existingFiles.has(filePath)) {
                delete this.fileCommentsData[filePath];
                changed = true;
            }
        }
        if (changed) {
            await this.saveComments();
        }
    }

    // 只加载可视区域的评论
    loadVisibleComments(visibleParagraphIds: string[]) {
        const currentFile = this.plugin.app.workspace.getActiveFile();
        if (!currentFile) return;

        visibleParagraphIds.forEach(paragraphId => {
            const comments = this.getCommentsByParagraphId(currentFile, paragraphId);
            this.commentCache.set(paragraphId, comments);
        });

        this.pruneCache();
    }

    private pruneCache() {
        if (this.commentCache.size > this.maxCacheSize) {
            // 删除最早/最少使用的缓存
            const entriesToDelete = Array.from(this.commentCache.keys())
                .slice(0, this.commentCache.size - this.maxCacheSize);
            entriesToDelete.forEach(key => this.commentCache.delete(key));
        }
    }

    // 批量更新评论
    batchUpdateComments(updates: Array<{id: string, comment: HighlightComment}>) {
        const batch = new Map<string, HighlightComment[]>();
        updates.forEach(({id, comment}) => {
            if (!batch.has(id)) {
                batch.set(id, []);
            }
            batch.get(id)?.push(comment);
        });
        
        batch.forEach((comments, id) => {
            this.comments.set(id, comments);
        });
    }

    private checkPerformance(operation: () => void) {
        const start = performance.now();
        operation();
        const duration = performance.now() - start;
        
        if (duration > this.PERFORMANCE_THRESHOLD) {
            console.warn(`Performance warning: Operation took ${duration}ms`);
        }
    }

    // 新增：根据段落ID获取评论
    getCommentsByParagraphId(file: TFile, paragraphId: string): HighlightComment[] {
        const fileComments = this.data[file.path] || {};
        return Object.values(fileComments).filter(
            highlight => highlight.paragraphId === paragraphId
        ).sort((a, b) => a.position - b.position);
    }

    // 新增：检查段落是否有评论
    hasParagraphComments(file: TFile, paragraphId: string): boolean {
        const comments = this.getCommentsByParagraphId(file, paragraphId);
        return comments.length > 0;
    }

    async clearAllComments() {
        this.data = {};
        this.fileCommentsData = {};
        await this.saveComments();
    }

    // 获取或生成 block ID
    private getBlockId(editor: Editor, line: number): string {
        const lineText = editor.getLine(line);
        const blockIdMatch = lineText.match(/\^([a-zA-Z0-9-]+)$/);
        
        if (blockIdMatch) {
            return blockIdMatch[1];
        }
        
        // 如果没有 block ID，生成一个并添加到行尾
        const newBlockId = Math.random().toString(36).substr(2, 9);
        editor.setLine(line, `${lineText} ^${newBlockId}`);
        return newBlockId;
    }
} 