import { ItemView, App, setIcon } from "obsidian";
import { ChatService, ChatMessage } from '../services/ChatService';
import { HighlightInfo } from '../types';

export class ChatView {
    private static instance: ChatView | null = null;
    private chatService: ChatService;
    private isProcessing: boolean = false;
    private containerEl: HTMLElement;
    private draggedContents: HighlightInfo[] = [];
    private chatHistory: { role: "user" | "assistant", content: string }[] = [];

    constructor(app: App, private plugin: any) {
        if (ChatView.instance) {
            return ChatView.instance;
        }

        this.chatService = new ChatService(this.plugin);
        
        // 创建容器
        this.containerEl = document.createElement('div');
        this.containerEl.addClass("highlight-chat-window");
        
        // 添加标题栏
        const header = this.containerEl.createEl("div", {
            cls: "highlight-chat-header"
        });

        // 添加标题文本
        header.createEl("div", {
            cls: "highlight-chat-title",
            text: "聊天"
        });

        // 添加关闭按钮
        const closeButton = header.createEl("div", {
            cls: "highlight-chat-close"
        });
        setIcon(closeButton, "x");
        closeButton.addEventListener("click", () => this.close());

        const chatHistory = this.containerEl.createEl("div", {
            cls: "highlight-chat-history"
        });

        const inputContainer = this.containerEl.createEl("div", {
            cls: "highlight-chat-input-container"
        });

        this.setupChatInput(inputContainer);

        // 创建一个临时的 HighlightInfo 对象
        const dummyHighlight: HighlightInfo = {
            text: "",
            position: 0,
            paragraphOffset: 0,
            paragraphId: "chat",
            paragraphText: "",
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        // 将拖拽事件处理器添加到整个历史区域
        chatHistory.addEventListener("dragenter", (e) => {
            e.preventDefault();
            chatHistory.addClass("drag-over");
        });

        chatHistory.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.stopPropagation();
            chatHistory.addClass("drag-over");

            // 计算聊天历史区域的可视区域位置
            const chatHistoryRect = chatHistory.getBoundingClientRect();
            const visibleTop = chatHistory.scrollTop;  // 当前滚动位置
            const visibleHeight = chatHistoryRect.height;  // 可视区域高度
            
            // 设置虚线框的位置，使其始终在可视区域内
            chatHistory.style.setProperty('--drag-guide-top', `${visibleTop + 12}px`);  // 顶部留出16px边距
            chatHistory.style.setProperty('--drag-guide-left', '12px');
            chatHistory.style.setProperty('--drag-guide-right', '12px');
            chatHistory.style.setProperty('--drag-guide-height', `${visibleHeight - 24}px`);  // 高度减去上下边距

            // 更新预览元素位置
            const preview = document.querySelector('.highlight-dragging') as HTMLElement;
            if (preview) {
                preview.style.left = `${e.clientX + 10}px`;
                preview.style.top = `${e.clientY + 10}px`;
            }
        });

        chatHistory.addEventListener("dragleave", (e) => {
            if (!chatHistory.contains(e.relatedTarget as Node)) {
                chatHistory.removeClass("drag-over");
            }
        });

        chatHistory.addEventListener("drop", async (e) => {
            e.preventDefault();
            chatHistory.removeClass("drag-over");

            const highlightData = e.dataTransfer?.getData("application/highlight");
            if (highlightData) {
                try {
                    const highlight = JSON.parse(highlightData);
                    if (!highlight.text) return;

                    // 检查是否已存在相同内容
                    const isDuplicate = this.draggedContents.some(
                        existing => existing.text === highlight.text
                    );

                    // 只有不重复的内容才添加
                    if (!isDuplicate) {
                        this.draggedContents.push(highlight);
                        this.showDraggedPreviews(chatHistory);
                    }
                } catch (error) {
                    console.error('Failed to process dropped highlight:', error);
                }
            }
        });

        // 添加标题栏拖拽功能
        let isDragging = false;
        let currentX: number;
        let currentY: number;
        let initialX: number;
        let initialY: number;

        header.addEventListener("mousedown", (e) => {
            if (e.target === closeButton) return; // 如果点击的是关闭按钮，不启动拖拽

            isDragging = true;
            initialX = e.clientX - this.containerEl.offsetLeft;
            initialY = e.clientY - this.containerEl.offsetTop;

            header.addClass("dragging");
        });

        document.addEventListener("mousemove", (e) => {
            if (!isDragging) return;

            e.preventDefault();
            
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            // 确保窗口不会被拖出视图
            const maxX = window.innerWidth - this.containerEl.offsetWidth;
            const maxY = window.innerHeight - this.containerEl.offsetHeight;
            
            currentX = Math.max(0, Math.min(currentX, maxX));
            currentY = Math.max(0, Math.min(currentY, maxY));

            this.containerEl.style.left = `${currentX}px`;
            this.containerEl.style.top = `${currentY}px`;
        });

        document.addEventListener("mouseup", () => {
            isDragging = false;
            header.removeClass("dragging");
        });

        ChatView.instance = this;
    }

    private showDraggedPreviews(container: HTMLElement) {
        // 移除旧的预览
        this.removeDraggedPreviews(container);

        // 创建预览消息
        const messageEl = container.createEl("div", {
            cls: "highlight-chat-message highlight-chat-message-preview"
        });

        // 创建预览容器
        const previewsContainer = messageEl.createEl("div", {
            cls: "highlight-chat-previews"
        });

        // 添加标题
        const headerEl = previewsContainer.createEl("div", {
            cls: "highlight-chat-preview-header"
        });

        headerEl.createEl("span", {
            cls: "highlight-chat-preview-count",
            text: String(this.draggedContents.length)
        });

        headerEl.createSpan({
            text: "条已选择内容"
        });

        // 创建卡片容器
        const cardsContainer = previewsContainer.createEl("div", {
            cls: "highlight-chat-preview-cards"
        });

        // 添加卡片
        this.draggedContents.forEach((content, index) => {
            const card = cardsContainer.createEl("div", {
                cls: "highlight-chat-preview-card"
            });

            card.createEl("div", {
                cls: "highlight-chat-preview-content",
                text: content.text
            });

            const deleteBtn = card.createEl("div", {
                cls: "highlight-chat-preview-delete"
            });
            setIcon(deleteBtn, "x");
            deleteBtn.addEventListener("click", () => {
                this.draggedContents.splice(index, 1);
                if (this.draggedContents.length === 0) {
                    messageEl.remove();
                } else {
                    this.showDraggedPreviews(container);
                }
            });
        });

        // 滚动到底部
        container.scrollTop = container.scrollHeight;
    }

    private removeDraggedPreviews(container: HTMLElement) {
        const previews = container.querySelector('.highlight-chat-message-preview');
        if (previews) {
            previews.remove();
        }
    }

    show() {
        if (document.body.contains(this.containerEl)) {
            return;
        }

        // 设置初始位置
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const chatWidth = 350;
        const chatHeight = windowHeight * 0.6;

        this.containerEl.style.right = '30px';
        this.containerEl.style.bottom = '90px';
        
        document.body.appendChild(this.containerEl);
    }

    close() {
        this.containerEl.remove();
        ChatView.instance = null;
    }

    private addMessage(container: HTMLElement, content: string, type: "user" | "assistant") {
        const messageEl = container.createEl("div", {
            cls: `highlight-chat-message highlight-chat-message-${type}`
        });

        const contentEl = messageEl.createEl("div", {
            cls: "highlight-chat-message-content"
        });

        if (type === "assistant") {
            // 为 AI 回复添加打字机效果
            this.typeWriter(contentEl, content);
        } else {
            // 用户消息直接显示
            contentEl.textContent = content;
        }

        container.scrollTop = container.scrollHeight;
    }

    private async typeWriter(element: HTMLElement, text: string, speed: number = 30) {
        let i = 0;
        element.textContent = ''; // 清空内容
        
        // 添加光标
        const cursor = element.createEl("span", {
            cls: "highlight-chat-cursor"
        });

        const type = () => {
            if (i < text.length) {
                element.insertBefore(document.createTextNode(text.charAt(i)), cursor);
                i++;
                setTimeout(type, speed);
            } else {
                // 打字完成后移除光标
                cursor.remove();
            }
        };

        type();
    }

    static getInstance(app: App, plugin: any): ChatView {
        if (!ChatView.instance) {
            ChatView.instance = new ChatView(app, plugin);
        }
        return ChatView.instance;
    }

    // 添加新的输入框实现
    private setupChatInput(inputContainer: HTMLElement) {
        // 创建输入框容器
        const inputWrapper = inputContainer.createEl('div', {
            cls: 'highlight-chat-input-wrapper'
        });

        // 创建文本输入框
        const textarea = inputWrapper.createEl('textarea', {
            cls: 'highlight-chat-input',
            attr: {
                placeholder: '输入消息...',
                rows: '1'
            }
        });

        // 自动调整高度
        const adjustHeight = () => {
            textarea.style.height = 'auto';
            textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`; // 最大高度150px
        };

        // 处理输事件
        textarea.addEventListener('input', () => {
            adjustHeight();
        });

        // 处理按键事件
        textarea.addEventListener('keydown', async (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                await this.handleSendMessage(textarea);
            }
        });

        return textarea;
    }

    // 处理发送消息
    private async handleSendMessage(textarea: HTMLTextAreaElement) {
        const content = textarea.value.trim();
        if (!content || this.isProcessing) return;

        try {
            this.isProcessing = true;
            
            // 准备发送的消息内容
            let messageToSend = content;
            let userMessage = content;

            // 如果有拖拽内容，将其作为单独的用户消息添加到历史记录
            if (this.draggedContents.length > 0) {
                const textsToAnalyze = this.draggedContents
                    .map(h => h.text)
                    .join('\n\n---\n\n');
                
                // 先添加高亮内容作为用户消息
                this.chatHistory.push({ 
                    role: "user", 
                    content: `以下是需要分析的内容：\n\n${textsToAnalyze}`
                });
                
                messageToSend = content;
                userMessage = `用户提示：${content}`;
                this.draggedContents = [];
            }

            // 添加用户消息到历史记录
            this.chatHistory.push({ role: "user", content: userMessage });

            // 清空输入框
            requestAnimationFrame(() => {
                textarea.value = '';
                textarea.style.height = 'auto';
                textarea.dispatchEvent(new Event('input'));
            });

            // 添加用户消息到UI
            const chatHistoryEl = this.containerEl.querySelector('.highlight-chat-history') as HTMLElement;
            if (chatHistoryEl) {
                this.addMessage(chatHistoryEl, content, "user");
                
                // 获取 AI 响应，传入完整的对话历史
                const response = await this.chatService.sendMessage(messageToSend, this.chatHistory);
                
                // 添加 AI 响应到历史记录
                this.chatHistory.push({ role: "assistant", content: response.content });
                
                // 添加 AI 响应到UI
                this.addMessage(chatHistoryEl, response.content, "assistant");
            }

        } catch (error) {
            console.error('Failed to get AI response:', error);
        } finally {
            this.isProcessing = false;
        }
    }
} 