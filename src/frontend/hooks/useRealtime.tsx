import useWebSocket from "react-use-websocket";

import {
    InputAudioBufferClearCommand,
    Message,
    RecognizingSpeech,
    RecognizedSpeech,
    SystemMessage
} from "../src/types";

type Parameters = {
    useDirectAoaiApi?: boolean; // If true, the middle tier will be skipped and the AOAI ws API will be called directly
    aoaiEndpointOverride?: string;
    aoaiApiKeyOverride?: string;
    aoaiModelOverride?: string;

    enableInputAudioTranscription?: boolean;
    onWebSocketOpen?: () => void;
    onWebSocketClose?: () => void;
    onWebSocketError?: (event: Event) => void;
    onWebSocketMessage?: (event: MessageEvent<any>) => void;

    onReceivedRecognizingSpeech?: (message: RecognizingSpeech) => void;
    onReceivedRecognizedSpeech?: (message: RecognizedSpeech) => void;
    onReceivedSystemMessage?: (message: SystemMessage) => void;

    onReceivedResponseAudio?: (audio_data: ArrayBuffer) => void;

    onReceivedError?: (message: Message) => void;
};

export default function useRealTime({
    onWebSocketOpen,
    onWebSocketClose,
    onWebSocketError,
    onWebSocketMessage,
    onReceivedRecognizingSpeech,
    onReceivedRecognizedSpeech,
    onReceivedSystemMessage,
    onReceivedResponseAudio,
    onReceivedError
}: Parameters) {

    const wsEndpoint = `/ws`;

    const { sendMessage, sendJsonMessage, getWebSocket } = useWebSocket(wsEndpoint, {
        onOpen: () => { 
            onWebSocketOpen?.() 
            const ws = getWebSocket();
            if (ws && 'binaryType' in ws) {
                (ws as WebSocket).binaryType = "arraybuffer"; // ✅ Force the type here
                console.log("Set binaryType to arraybuffer.");
            }
        },
        onClose: () => onWebSocketClose?.(),
        onError: event => onWebSocketError?.(event),
        onMessage: event => onMessageReceived(event),
        shouldReconnect: () => true
    });

    const startSession = () => {
        console.log("startSession")
    };

    const addUserAudio = (audio: ArrayBuffer) => {
        console.log("addUserAudio")

        sendMessage(audio);
    };

    const inputAudioBufferClear = () => {
        console.log("inputAudioBufferClear")

        // TODO, nateko, this isn't consumed by the server at this time. 
        const command: InputAudioBufferClearCommand = {
            type: "input_audio_buffer.clear"
        };

        sendJsonMessage(command);
    };

    const onMessageReceived = (event: MessageEvent<any>) => {

        onWebSocketMessage?.(event);

        if (event.data instanceof ArrayBuffer) {
            // This is binary data as ArrayBuffer
            console.log("received audio bytes")
            onReceivedResponseAudio?.(event.data); // TODO, nateko, this is hacky. Try encoded base64 string in a json object.
        }
        else {
            console.log("received a string message")
            let message: Message;
            try {
                message = JSON.parse(event.data);
            } catch (e) {
                console.error("Failed to parse JSON message:", e);
                throw e;
            }

            switch (message.type) {
                case "recognizing_speech":
                    onReceivedRecognizingSpeech?.(message as RecognizingSpeech);
                    break;
                case "recognized_speech":
                    onReceivedRecognizedSpeech?.(message as RecognizedSpeech);
                    break;
                case "system_message":
                    onReceivedSystemMessage?.(message as SystemMessage);
                    break;
                case "error":
                    onReceivedError?.(message);
                    break;
            }
        }
    };

    return { startSession, addUserAudio, inputAudioBufferClear };
}
