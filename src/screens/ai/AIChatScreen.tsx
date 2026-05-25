import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { AIChatBubble } from '../../components/ai/AIChatBubble';
import { AIReasoningBlock } from '../../components/ai/AIReasoningBlock';
import { FileActionBlock } from '../../components/ai/FileActionBlock';
import { SmartInputArea } from '../../components/input/SmartInputArea';
import { useChatStore } from '../../../stores/useChatStore';

export const AIChatScreen: React.FC = () => {
  const { theme } = useTheme();
  const { messages, addMessage, setTyping } = useChatStore();

  const handleSend = (text: string) => {
    addMessage({
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    });
    setTyping(true);
    setTimeout(() => {
      addMessage({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Processing: "${text}"\n\nI'll analyze the codebase and implement the requested changes. Let me examine the relevant files first.`,
        timestamp: new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
        reasoning:
          'Analyzing the user request, checking existing patterns in the codebase, and determining the best approach for implementation.',
        fileActions: [
          { type: 'modify', path: 'src/index.ts', lines: 15 },
        ],
      });
      setTyping(false);
    }, 1500);
  };

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="AI Assistant"
        subtitle="INTELLIGENT CODE AGENT"
        onBack={() => {}}
        rightAction={
          <View style={styles.statusDot}>
            <View
              style={[
                styles.dot,
                { backgroundColor: theme.colors.secondary },
              ]}
            />
          </View>
        }
      />
      <ScrollView style={styles.chatArea} contentContainerStyle={styles.chatContent}>
        {messages.map(msg => (
          <View key={msg.id}>
            <AIChatBubble message={msg} />
            {msg.role === 'assistant' && msg.reasoning && (
              <AIReasoningBlock reasoning={msg.reasoning} />
            )}
            {msg.role === 'assistant' && msg.fileActions && (
              <FileActionBlock actions={msg.fileActions} />
            )}
          </View>
        ))}
      </ScrollView>
      <SmartInputArea onSend={handleSend} onVoicePress={() => {}} />
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  chatArea: {
    flex: 1,
  },
  chatContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 20,
  },
  statusDot: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
