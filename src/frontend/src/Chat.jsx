// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { useState, useEffect, useRef } from 'react';
import Markdown from 'react-markdown'
import useAudioRecorder from "/hooks/useAudioRecorder";
import useAudioPlayer from '/hooks/useAudioPlayer';
import useRealTime from "/hooks/useRealtime";
import { Button } from "/components/ui/button";
import StatusMessage from "/components/ui/status-message";

import { Mic, MicOff } from "lucide-react";
import { useTranslation } from "react-i18next";

const Chat = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [messages, setMessages] = useState([]);
    const [isTyping, setIsTyping] = useState(false);
    const [transcription, setTranscription] = useState("");

    const { startSession, addUserAudio, inputAudioBufferClear } = useRealTime({
        onWebSocketOpen: () => console.log("WebSocket connection opened"),
        onWebSocketClose: () => console.log("WebSocket connection closed"),
        onWebSocketError: event => console.error("WebSocket error:", event),
        onReceivedError: message => console.error("error", message),
        onReceivedRecognizingSpeech: message => {
            console.log("recognizing speech received : ", message.transcript);
            setTranscription(message.transcript)
        },
        onReceivedRecognizedSpeech: message => {
            console.log("recognized speech received : ", message.transcript);
            setTranscription(message.transcript)
            setMessages((prevMessages) => [
                ...prevMessages, { role: "User", content: message.transcript }
            ]);
            setTranscription("")
            setIsTyping(true);            
        },
        onReceivedSystemMessage: message => {
            console.log("system message received: ", message.messages);
            setIsTyping(false);

            for (const msg of message.messages) {
                setMessages((prevMessages) => [
                    ...prevMessages, { role: "System", content: msg }
                ]);
            }
        },
        onReceivedResponseAudio: audio_data => {
            console.log("audio received.");
            isRecording && playAudio(audio_data);
        }
    });

    const { reset: resetAudioPlayer, playBinaryBuffer: playAudio, stop: stopAudioPlayer } = useAudioPlayer();
    const { start: startAudioRecording, stop: stopAudioRecording } = useAudioRecorder({ onAudioRecorded: addUserAudio });

    const onToggleListening = async () => {
        if (!isRecording) {
            console.log("start recording..")
            startSession();
            await startAudioRecording();
            resetAudioPlayer();

            setIsRecording(true);
        } else {
            console.log("stop recording..")
            await stopAudioRecording();
            stopAudioPlayer();
            inputAudioBufferClear();

            setIsRecording(false);
        }
    };

    const messageEndRef = useRef(null);
    const welcomeMessage = 'Ask a question...';

    const scrollToBottom = () => {
        messageEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages])

    const createSystemInput = (userMessageContent) => {
        return {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                message: userMessageContent
            })
        }
    };

    const parseSystemResponse = (systemResponse) => {
        const messages = systemResponse["messages"]
        return messages
    }

    const chatWithSystem = async (userMessageContent) => {
        try {
            const response = await fetch(
                `/chat`,
                createSystemInput(userMessageContent)
            );

            if (!response.ok) {
                throw new Error("Oops! Bad chat response.");
            }

            const systemResponse = await response.json();
            const systemMessages = parseSystemResponse(systemResponse);
            console.log(systemMessages)

            return systemMessages;
        } catch (error) {
            console.error("Error while processing chat: ", error)
        }
    };

    const handleSendMessage = async (userMessageContent) => {
        setMessages((prevMessages) => [
            ...prevMessages, { role: "User", content: userMessageContent }
        ]);

        setIsTyping(true);
        const systemMessages = await chatWithSystem(userMessageContent);
        setIsTyping(false);

        for (const msg of systemMessages) {
            setMessages((prevMessages) => [
                ...prevMessages, { role: "System", content: msg }
            ]);
        }
    };

    const { t } = useTranslation();

    return (
        <div className="chat-container">
            <div className="chat-messages">
                {messages.length == 0 && (<div className="message.content">{welcomeMessage}</div>)}
                {messages.map((message, index) => (
                    <div key={index} tabindex="0" className={message.role === 'user' ? "message.user" : "message.agent"}>
                        <div className="message">
                            <h3 className="message-header">{message.role}</h3>
                            <Markdown className="message.content">{message.content}</Markdown>
                        </div>
                    </div>
                ))}
                {isTyping && <p className="message">System is typing...</p>}
                <div ref={messageEndRef}/>
            </div>
            <form
                className="chat-input-form"
                onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.target.input.value;
                    if (input.trim() != "") {
                        handleSendMessage(input);
                        e.target.reset();
                    }
                }}
                aria-label="Chat Input Form"
            >
                <input
                    className="chat-input"
                    type="text"
                    name="input"
                    placeholder="Type your message..."
                    value={isRecording ? transcription : ""}
                    disabled={isTyping}
                    readOnly={isRecording}
                />
                    
                <button
                    className="chat-submit-button" 
                    type="submit"
                >
                    Send
                </button>

                <Button
                    onClick={onToggleListening}
                    className={`h-12 w-60 ${isRecording ? "bg-red-600 hover:bg-red-700" : "bg-purple-500 hover:bg-purple-600"}`}
                    aria-label={isRecording ? t("app.stopRecording") : t("app.startRecording")}
                >
                    {isRecording ? (
                        <>
                            <MicOff className="mr-2 h-4 w-4" />
                            {t("app.stopConversation")}
                        </>
                    ) : (
                        <>
                            <Mic className="mr-2 h-6 w-6" />
                        </>
                    )}
                </Button>
            </form>
            <br/>
            
            <div className="mb-4 flex flex-col items-center justify-center">
                <StatusMessage isRecording={isRecording} />
            </div>            
        </div>
    );
}

export default Chat;
