import useWebSocket from "react-use-websocket";

import {
    InputAudioBufferAppendCommand,
    InputAudioBufferClearCommand,
    Message,
    ResponseAudioDelta,
    ResponseAudioTranscriptDelta,
    ResponseDone,
    SessionUpdateCommand,
    ExtensionMiddleTierToolResponse,
    ResponseInputAudioTranscriptionCompleted,
    ConversationItemCreated,
    ResponseFunctionCallArgumentsDone,
    ResponseOutputItemDone,
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

    onReceivedResponseAudioDelta?: (message: ResponseAudioDelta) => void;
    onReceivedResponseAudioArrayBuffer?: (audio_data: ArrayBuffer) => void;
    onReceivedResponseAudioBlob?: (audio_data: Blob) => void;
    onReceivedInputAudioBufferSpeechStarted?: (message: Message) => void;
    onReceivedResponseDone?: (message: ResponseDone) => void;
    onReceivedExtensionMiddleTierToolResponse?: (message: ExtensionMiddleTierToolResponse) => void;
    onReceivedResponseAudioTranscriptDelta?: (message: ResponseAudioTranscriptDelta) => void;
    onReceivedInputAudioTranscriptionCompleted?: (message: ResponseInputAudioTranscriptionCompleted) => void;
    onReceivedConversationItemCreated?: (message: ConversationItemCreated) => void;
    onReceivedResponseFunctionCallArgumentsDone?: (message: ResponseFunctionCallArgumentsDone) => void;
    onReceivedResponseOutputItemDone?: (message: ResponseOutputItemDone) => void;
    onReceivedError?: (message: Message) => void;
};

export default function useRealTime({
    useDirectAoaiApi,
    aoaiEndpointOverride,
    aoaiApiKeyOverride,
    aoaiModelOverride,
    enableInputAudioTranscription,
    onWebSocketOpen,
    onWebSocketClose,
    onWebSocketError,
    onWebSocketMessage,
    onReceivedRecognizingSpeech,
    onReceivedRecognizedSpeech,
    onReceivedSystemMessage,
    onReceivedResponseDone,
    onReceivedResponseAudioDelta,
    onReceivedResponseAudioArrayBuffer,
    onReceivedResponseAudioBlob,
    onReceivedResponseAudioTranscriptDelta,
    onReceivedInputAudioBufferSpeechStarted,
    onReceivedExtensionMiddleTierToolResponse,
    onReceivedInputAudioTranscriptionCompleted,
    onReceivedConversationItemCreated,
    onReceivedResponseFunctionCallArgumentsDone,
    onReceivedResponseOutputItemDone,
    onReceivedError
}: Parameters) {
    // const wsEndpoint = useDirectAoaiApi
    //     ? `${aoaiEndpointOverride}/openai/realtime?api-key=${aoaiApiKeyOverride}&deployment=${aoaiModelOverride}&api-version=2024-10-01-preview`
    //     : `/realtime`;

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
        // const socket = getWebSocket()

        // const command: SessionUpdateCommand = {
        //     type: "session.update",
        //     session: {
        //         turn_detection: {
        //             type: "server_vad"
        //         }
        //     }
        // };

        // if (enableInputAudioTranscription) {
        //     command.session.input_audio_transcription = {
        //         model: "whisper-1"
        //     };
        // }

        // sendJsonMessage(command);
    };

    // const addUserAudio = (base64Audio: string) => {
    //     //console.log("addUserAudio")
    //     // const command: InputAudioBufferAppendCommand = {
    //     //     type: "input_audio_buffer.append",
    //     //     audio: base64Audio
    //     // };

    //     //sendJsonMessage(command);
    //     //sendMessage(base64Audio)
    //     //var ws = getWebSocket;
    //     console.log("addUserAudio", base64Audio)

    //     //const binaryData = new TextEncoder().encode(base64Audio);
    //     sendMessage(base64Audio);
    // };

    const addUserAudio = (audio: ArrayBuffer) => {
        //console.log("addUserAudio", audio)

        sendMessage(audio);
    };

    const inputAudioBufferClear = () => {
        console.log("inputAudioBufferClear")

        const command: InputAudioBufferClearCommand = {
            type: "input_audio_buffer.clear"
        };

        sendJsonMessage(command);
    };

    const onMessageReceived = (event: MessageEvent<any>) => {
        console.log("onMessageReceived")

        onWebSocketMessage?.(event);

        console.log("Type:", event.data.constructor.name); 

        if (event.data instanceof ArrayBuffer) {
            // This is binary data as ArrayBuffer
            console.log("Received binary data as ArrayBuffer");
            onReceivedResponseAudioArrayBuffer?.(event.data);
        }
        else {
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
                case "response.done":
                    onReceivedResponseDone?.(message as ResponseDone);
                    break;
                case "response.audio.delta":
                    onReceivedResponseAudioDelta?.(message as ResponseAudioDelta);
                    break;
                case "response.audio_transcript.delta":
                    onReceivedResponseAudioTranscriptDelta?.(message as ResponseAudioTranscriptDelta);
                    break;
                case "input_audio_buffer.speech_started":
                    onReceivedInputAudioBufferSpeechStarted?.(message);
                    break;
                case "conversation.item.input_audio_transcription.completed":
                    onReceivedInputAudioTranscriptionCompleted?.(message as ResponseInputAudioTranscriptionCompleted);
                    break;
                case "extension.middle_tier_tool_response":
                    onReceivedExtensionMiddleTierToolResponse?.(message as ExtensionMiddleTierToolResponse);
                    break;
                case "conversation.item.created":
                    onReceivedConversationItemCreated?.(message as ConversationItemCreated);
                    break;
                case "response.function_call_arguments.done":
                    onReceivedResponseFunctionCallArgumentsDone?.(message as ResponseFunctionCallArgumentsDone);
                    break;
                case "response.output_item.done":
                    onReceivedResponseOutputItemDone?.(message as ResponseOutputItemDone);
                    break;
                case "error":
                    onReceivedError?.(message);
                    break;
            }
        }
    };

    return { startSession, addUserAudio, inputAudioBufferClear };
}
