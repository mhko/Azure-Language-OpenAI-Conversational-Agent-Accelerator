import { useRef } from "react";
import { Recorder } from "../components/audio/recorder";

const BUFFER_SIZE = 4800;

type Parameters = {
    onAudioRecorded: (audio: ArrayBuffer) => void;
    //onAudioRecorded: (base64: string) => void;
};

export default function useAudioRecorder({ onAudioRecorded }: Parameters) {
    const audioRecorder = useRef<Recorder | null>(null);

    let buffer = new Uint8Array();

    const appendToBuffer = (newData: Uint8Array) => {
        const newBuffer = new Uint8Array(buffer.length + newData.length);
        newBuffer.set(buffer);
        newBuffer.set(newData, buffer.length);
        buffer = newBuffer;
    };

    const handleAudioData = (data: Iterable<number>) => {
        const uint8Array = new Uint8Array(data);
        appendToBuffer(uint8Array);

        if (buffer.length >= BUFFER_SIZE) {
            const toSend = new Uint8Array(buffer.slice(0, BUFFER_SIZE));
            buffer = new Uint8Array(buffer.slice(BUFFER_SIZE));

            onAudioRecorded(toSend.buffer)
            // const regularArray = String.fromCharCode(...toSend);
            // const base64 = btoa(regularArray);

            //onAudioRecorded(base64);
        }
    };

    const start = async () => {
        console.log("starting audio recorder")
        if (!audioRecorder.current) {
            audioRecorder.current = new Recorder(handleAudioData);
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioRecorder.current.start(stream);
    };

    const stop = async () => {
        console.log("stopping audio recorder")
        await audioRecorder.current?.stop();
    };

    return { start, stop };
}
