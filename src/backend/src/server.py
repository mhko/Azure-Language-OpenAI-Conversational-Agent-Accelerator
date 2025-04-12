# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.
import os
import json
import importlib
import pii_redacter
from json import JSONDecodeError
#from flask import Flask, request, jsonify, render_template
#from flask_sock import Sock
from azure.search.documents import SearchClient
from aoai_client import AOAIClient, get_prompt
from router.router_type import RouterType
from unified_conversation_orchestrator import UnifiedConversationOrchestrator
from utils import get_azure_credential
import azure.cognitiveservices.speech as speechsdk
import asyncio
#from quart import Quart
from quart import Quart, request, jsonify, render_template, websocket
# from quart.websocket import ConnectionClosed
from datetime import datetime
import base64
from azure.cognitiveservices.speech.audio import AudioOutputStream, AudioConfig

# Flask server:
app = Quart(__name__, static_url_path='',
            static_folder='dist',
            template_folder='dist')

#sock = Sock(app)

# RAG AOAI client:
search_client = SearchClient(
    endpoint=os.environ.get("SEARCH_ENDPOINT"),
    index_name=os.environ.get("SEARCH_INDEX_NAME"),
    credential=get_azure_credential()
)
rag_client = AOAIClient(
    endpoint=os.environ.get("AOAI_ENDPOINT"),
    deployment=os.environ.get("AOAI_DEPLOYMENT"),
    use_rag=True,
    search_client=search_client
)

# Extract-utterances AOAI client:
extract_prompt = get_prompt("extract_utterances.txt")
extract_client = AOAIClient(
    endpoint=os.environ.get("AOAI_ENDPOINT"),
    deployment=os.environ.get("AOAI_DEPLOYMENT"),
    system_message=extract_prompt
)

# PII:
PII_ENABLED = os.environ.get("PII_ENABLED", "false").lower() == "true"


# Fallback function (RAG):
def fallback_function(
    query: str,
    language: str,
    id: int
) -> str:
    """
    Call RAG client for grounded chat completion.
    """
    if PII_ENABLED:
        # Redact PII:
        query = pii_redacter.redact(
            text=query,
            id=id,
            language=language,
            cache=True
        )

    return rag_client.chat_completion(query)


# Unified-Conversation-Orchestrator:
router_type = RouterType(os.environ.get("ROUTER_TYPE", "BYPASS"))
orchestrator = UnifiedConversationOrchestrator(
    router_type=router_type,
    fallback_function=fallback_function
)
chat_id = 0


def orchestrate_chat(message: str) -> list[str]:
    if PII_ENABLED:
        # Redact PII:
        message = pii_redacter.redact(
            text=message,
            id=chat_id,
            cache=True
        )

    # Break user message into separate utterances:
    utterances = extract_client.chat_completion(message)
    print(f"Utterances: {utterances}")
    if not isinstance(utterances, list):
        try:
            utterances = json.loads(utterances)
        except JSONDecodeError:
            # Harmful content case:
            if PII_ENABLED:
                # Clean up PII memory:
                pii_redacter.remove(id=chat_id)
            return ['I am unable to respond or participate in this conversation.']

    # Process each utterance:
    responses = []
    for query in utterances:
        if PII_ENABLED:
            # Reconstruct PII:
            query = pii_redacter.reconstruct(
                text=query,
                id=chat_id,
                cache=True
            )

        # Orchestrate:
        orchestration_response = orchestrator.orchestrate(
            message=query,
            id=chat_id
        )

        # Parse response:
        response = None
        if orchestration_response["route"] == "fallback":
            response = orchestration_response["result"]

        elif orchestration_response["route"] == "clu":
            intent = orchestration_response["result"]["intent"]
            entities = orchestration_response["result"]["entities"]

            # Here, you may call external functions based on recognized intent:
            hooks_module = importlib.import_module("clu_hooks")
            hook_func = getattr(hooks_module, intent)

            response = hook_func(entities)

        elif orchestration_response["route"] == "cqa":
            answer = orchestration_response["result"]["answer"]

            response = answer

        print(f"Orchestration response: {orchestration_response}")
        print(f"Parsed response: {response}")
        responses.append(response)

    if PII_ENABLED:
        # Clean up PII memory:
        pii_redacter.remove(id=chat_id)

    return responses

def create_speech_sythesizer(on_audio_chunk, on_audio_chunk_bytes):
    """
    Allows to create a client for the speech synthesizer
    """
    class PushAudioOutputStreamSampleCallback(speechsdk.audio.PushAudioOutputStreamCallback):
        """
        Example class that implements the PushAudioOutputStreamCallback, which is used to show
        how to push output audio to a stream
        """
        def __init__(self, on_audio_chunk, on_audio_chunk_bytes) -> None:
            super().__init__()
            self._audio_data = bytes(0)
            self._closed = False
            self.on_audio_chunk = on_audio_chunk
            self.on_audio_chunk_bytes = on_audio_chunk_bytes

        def write(self, audio_buffer: memoryview) -> int:
            """
            The callback function which is invoked when the synthesizer has an output audio chunk
            to write out
            """
            self._audio_data += audio_buffer
            print("{} bytes received.".format(audio_buffer.nbytes))
            self.on_audio_chunk_bytes(audio_buffer.tobytes())            
            return audio_buffer.nbytes

        def close(self) -> None:
            """
            The callback function which is invoked when the synthesizer is about to close the
            stream.
            """
            self._closed = True
            print("Push audio output stream closed.")

        def get_audio_data(self) -> bytes:
            return self._audio_data

        def get_audio_size(self) -> int:
            return len(self._audio_data)

    speech_config = speechsdk.SpeechConfig(
        subscription=os.environ.get("SPEECH_KEY"),
        region=os.environ.get("SPEECH_REGION")
    )
    callback = PushAudioOutputStreamSampleCallback(websocket, on_audio_chunk)
    stream = speechsdk.audio.PushAudioOutputStream(callback)
    audio_config = speechsdk.audio.AudioConfig(stream=stream)

    # The neural multilingual voice can speak different languages based on the input text.
    speech_config.speech_synthesis_voice_name='en-US-AvaMultilingualNeural'
    #speech_synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=None)
    speech_synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=audio_config)
    return speech_synthesizer #, stream

def create_speech_recognizer(loop, queue):
    """
    Allows to create a client for the speech recognizer and a stream (buffer)
    """
    # Create the configuration of the recognizer from your account of Azure
    speech_config = speechsdk.SpeechConfig(
        subscription=os.environ.get("SPEECH_KEY"),
        region=os.environ.get("SPEECH_REGION")
    )

    # Configuration for the input audio format. The documentation specifies that you can use GStreamer (It also needs to be installed locally) to encode other formats to PCM (Pulse Code Modulation).
    # Here I'm using speechsdk.AudioStreamContainerFormat.ANY since i'm sending streaming data using the audio/webm;codecs:opus format directl, that is supported for most of the modern browsers
    #format = speechsdk.audio.AudioStreamFormat(compressed_stream_format=speechsdk.AudioStreamContainerFormat.ANY) # To receive audio data in any format and process them with GStreamer
    #format = speechsdk.audio.AudioStreamFormat(samples_per_second=24000, bits_per_sample=32, channels=1, wave_stream_format=speechsdk.AudioStreamWaveFormat.MULAW) # To receive audio data in any format and process them with GStreamer
    #format = speechsdk.audio.AudioStreamFormat(samples_per_second=24000, bits_per_sample=32, channels=1, wave_stream_format=speechsdk.AudioStreamWaveFormat.FLOAT) # To receive audio data in any format and process them with GStreamer
    #format = speechsdk.audio.AudioStreamFormat(compressed_stream_format=speechsdk.AudioStreamContainerFormat.ANY) # To receive audio data in any format and process them with GStreamer
    #stream = speechsdk.audio.PushAudioInputStream(format) # Creates an audio stream to send data to the speech service
    format = speechsdk.audio.AudioStreamFormat(samples_per_second=16000, bits_per_sample=16, channels=1, wave_stream_format=speechsdk.AudioStreamWaveFormat.PCM) # To receive audio data in any format and process them with GStreamer

    stream = speechsdk.audio.PushAudioInputStream(format) # Creates an audio stream to send data to the speech service
    audio_config = speechsdk.audio.AudioConfig(stream=stream) # Adjust the audio config using the recently created stream

    # Creates a speech recognizer client for the speech recognizer
    speech_recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config,
        audio_config=audio_config,
        language="en-US" # Change to your desired language if supported. If not specified, 'en-US' will be used by default.
    )

    # Callbacks for the speech recognizer. They are automatically triggered based on event type
    def recognizing_cb(evt: speechsdk.SpeechRecognitionEventArgs):
        """
        Triggered everytime the recognizer has processed a set of audio chunks and recognized part of the speech
        """
        print(f"Azure Speech Recognition -> Recognizing: {evt.result.text}")
        json_string = f"""
        {{
            "type": "recognizing_speech",
            "transcript": "{evt.result.text}"
        }}
        """
        asyncio.run_coroutine_threadsafe(queue.put(json_string), loop)
        #asyncio.run_coroutine_threadsafe(queue.put(evt.result.text), loop)

    def recognized_cb(evt: speechsdk.SpeechRecognitionEventArgs):
        """
        Triggered when the speech recognition has processed an audio fragment and recognized the text in its entirety
        """
        print(f"Azure Speech Recognition -> Recognized: {evt.result.text}")
        print(f"Azure Speech Recognition -> Recognized: {evt}")
        json_string = f"""
        {{
            "type": "recognized_speech",
            "transcript": "{evt.result.text}"
        }}
        """
        asyncio.run_coroutine_threadsafe(queue.put(json_string), loop)
        #asyncio.run_coroutine_threadsafe(queue.put(evt.result.text), loop)

    def stop_cb(evt: speechsdk.SessionEventArgs):
        """
        Triggered when speech recognition session is stopped
        """
        print(f"Azure Speech Recognition -> Session stopped due websocket close: {evt}")

    def canceled_cb(evt: speechsdk.SessionEventArgs):
        """
        Triggered when the speech recognition session is cancelled due to an error
        """
        print(f"Azure Speech Recognition -> Session canceled due an error: {evt}")

    # Connect callbacks to the speech recognizer to be triggered when an event occurs.
    speech_recognizer.recognizing.connect(recognizing_cb)
    speech_recognizer.recognized.connect(recognized_cb)
    speech_recognizer.session_stopped.connect(stop_cb)
    speech_recognizer.canceled.connect(canceled_cb)

    return speech_recognizer, stream

@app.route("/")
async def home_page():
    return await render_template("index.html")

@app.route("/chat", methods=['POST'])
async def chat():
    content = request.json
    message = content["message"]

    responses = orchestrate_chat(message)

    print(f"responses: {responses}")
    return jsonify({
        "messages": responses
    })

@app.websocket('/ws')
async def ws():
    print(f"connect /ws")
    loop = asyncio.get_event_loop()
    message_queue = asyncio.Queue()

    # async def send_chunk(websocket, audio_chunk):
    #     await websocket.send(audio_chunk)

    # We need to bridge sync callback with async send
    def on_audio_chunk(audio_chunk):
        #asyncio.create_task(send_chunk(audio_chunk))
        #loop.call_soon_threadsafe(asyncio.create_task, send_chunk(websocket, audio_chunk))
        # message_queue.put(audio_chunk)
        asyncio.run_coroutine_threadsafe(message_queue.put(audio_chunk), loop)

    speech_recognizer, stream = create_speech_recognizer(loop, message_queue)
    speech_synthesizer = create_speech_sythesizer(on_audio_chunk, on_audio_chunk)

    # async def on_audio_stream_received(buffer: bytes):
    # # send buffer over websocket
    #     await websocket.send(buffer)

    # # Callback for when audio data is available
    # def write_callback(audio_chunk):
    #     on_audio_stream_received(audio_chunk)
        
    #ttsstream.write = write_callback

    async def receive_audio(websocket, stream):
        audio_data = b"" # Store the audio data in bytes
        reset_audio_data = b""
        print(f"WebSocket -> Receiving audio from client and saving into stream...")
        while True: # As long as the customer is connected
            try: # Attempt to receive audio data from the client
                data = await websocket.receive() #.receive_bytes()  # Receive audio data from the client

                if isinstance(data, bytes):
                    #byte_data = base64.b64decode(data)

                    audio_data += data  # Store audio all data chunks in a variable
                    reset_audio_data += data
                    stream.write(data)  # Write audio data to the stream buffer
                else:
                    print(f"{data}")
                # data = await websocket.receive_bytes()  # Receive audio data from the client
                # audio_data += data  # Store audio all data chunks in a variable
                # stream.write(data)  # Write audio data to the stream buffer

                # print(f"WebSocket -> Stream data in bytes: {len(data)}", end="\n")  # Data that are being sent from the client

                if (len(reset_audio_data) > 200000):
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    with open(f"records/received_audio_{timestamp}.pcm", "wb") as f: # Create an audio file in webm format
                        f.write(audio_data) # Write the whole audio data to the file
                        print(f"API -> Audio data exported!")
                    reset_audio_data = b""

            except Exception as e:  # If an error occurs or the client disconnects
                print(f"Error: {e}")
                if isinstance(e, asyncio.CancelledError):
                    break  # Client disconnected gracefully

            #except ConnectionClosed:  # If the client is disconnected
                print(f"Azure Speech Recognition -> Stream closed")
                stream.close()  # Close the stream

                print(f"API -> Websocket client disconnected!")
                print(f"API -> Stopping continuous recognition...")
                speech_recognizer.stop_continuous_recognition() # Stop speech recognition
                print(f"API -> Continuous recognition stopped!")
                print(f"API -> Exporting audio data to a file...")

                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                with open(f"records/new_received_audio_{timestamp}.pcm", "wb") as f: # Create an audio file in webm format
                    f.write(audio_data) # Write the whole audio data to the file
                    print(f"API -> Audio data exported!")

                # Save received audio data to a file
                # with open(f"received_audio_{datetime.now()}.pcm", "wb") as f: # Create an audio file in webm format
                #     f.write(audio_data) # Write the whole audio data to the file
                #     print(f"API -> Audio data exported!")
                break
            # except Exception as e: # If an error occurs
            #     print(f"Error: {e}")
            #     break # Exiting the loop        

    async def send_messages():
        """
        Allows messages recognized by the Azure service to be sent to the client via the websocket to the client
        """
        while True: # As long as the customer is connected
            message = await message_queue.get() # Get the recognized text from the queue
            #await websocket.send_text(message) # Send the text to the websocket client
            print(f"message type {type(message)}")
            if isinstance(message, memoryview):
                print(f"sending bytes over websocket {message.nbytes}")
                await websocket.send(message.tobytes())
            if isinstance(message, bytes):
                print(f"sending bytes over websocket bytes")
                await websocket.send(message)
            elif isinstance(message, str):
                print(f"message: {message}")
                await websocket.send(message) # Send the text to the websocket client

                parsed = json.loads(message)
                if parsed["type"] == "recognized_speech":
                    responses = orchestrate_chat(parsed["transcript"])
                    if responses:
                        #result = speech_synthesizer.speak_text_async(" ".join(responses)).get()
                        # result = speech_synthesizer.speak_text_async(responses[-1]).get()
                        #speech_synthesizer = create_speech_sythesizer(websocket, on_audio_chunk)
                        speech_synthesizer.speak_text_async(" ".join(responses)).get()
                        # system_message = jsonify({
                        #     "type": "system_message",
                        #     "messages": responses
                        # })
                        # json_string = f"""
                        # {{
                        #     "type": "recognizing_speech",
                        #     "messages": "{responses}"
                        # }}
                        # """                    
                        json_string = json.dumps({
                            "type": "system_message",
                            "messages": responses
                        })
                        await websocket.send(json_string)
                        # if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
                        #     print("TTS succeeded.")
                        #     audio_data = result.audio_data  # This is raw audio bytes
                        #     print(f"type(audio_data) : {type(audio_data)}")  # ➡️ <class 'bytes'>
                        #     await websocket.send(audio_data)
                        # else:
                        #     print(f"TTS failed. Reason: {result.reason}")
                        #     await websocket.send(b"TTS failed.")
                # audio_data = response.audio_data
                # await websocket.send(audio_data)
                else: 
                    print(f"unsupported type: {parsed["type"]}")

    try:
        speech_recognizer.start_continuous_recognition() # Start continuous speech recognition
        print("API -> Continuous recognition running, say something to process data...")
        await asyncio.gather(receive_audio(websocket, stream), send_messages()) # Execute the functions of receiving audio and sending messages back to the client.

    except Exception as e:
        print(f"Error: {e}")