import { useRef } from "react";

import { Player } from "../components/audio/player";

const SAMPLE_RATE = 16000;

export default function useAudioPlayer() {
    const audioPlayer = useRef<Player | null>(null);;

    const reset = () => {
        audioPlayer.current = new Player();
        audioPlayer.current.init(SAMPLE_RATE);
    };

    const play = (base64Audio: string) => {
        const binary = atob(base64Audio);
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        const pcmData = new Int16Array(bytes.buffer);

        audioPlayer.current?.play(pcmData);
    };

    const playBinaryBuffer = (arrayBuffer: ArrayBuffer) => {
        const pcmData = new Int16Array(arrayBuffer);

        audioPlayer.current?.play(pcmData);
    };

    const stop = () => {
        audioPlayer.current?.stop();
    };

    return { reset, play, playBinaryBuffer, stop };
}