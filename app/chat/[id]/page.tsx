import { LuminaApp } from "@/components/LuminaApp";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  return <LuminaApp initialSurface="chat" initialConversationId={(await params).id} />;
}
