export type InputAudioBufferClearCommand = {
    type: "input_audio_buffer.clear";
};

export type Message = {
    type: string;
};

export type RecognizingSpeech = {
    type: "recognizing_speech";
    transcript: string;
};

export type RecognizedSpeech = {
    type: "recognized_speech";
    transcript: string;
};

export type SystemMessage = {
    type: "system_message";
    messages: string[];
};