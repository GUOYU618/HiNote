export interface Flashcard {
    id: string;
    front: string;    // highlight text
    back: string;     // comment content
    sourceFile?: string;  // 原文件来源
}

export interface FlashcardState {
    currentIndex: number;
    isFlipped: boolean;
    cards: Flashcard[];
}
