import { create } from 'zustand';
import {
  ChatMessage,
  mockChatMessages,
} from '../src/data/mockData';

interface ChatState {
  messages: ChatMessage[];
  isTyping: boolean;
  addMessage: (message: ChatMessage) => void;
  setTyping: (typing: boolean) => void;
}

export const useChatStore = create<ChatState>()(set => ({
  messages: mockChatMessages,
  isTyping: false,
  addMessage: message =>
    set(state => ({ messages: [...state.messages, message] })),
  setTyping: typing => set({ isTyping: typing }),
}));
