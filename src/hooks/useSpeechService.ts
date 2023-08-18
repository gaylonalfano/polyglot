import type { VoiceInfo } from 'microsoft-cognitiveservices-speech-sdk'
import {
  AudioConfig,
  CancellationErrorCode,
  SpeakerAudioDestination,
  SpeechConfig,
  SpeechRecognizer,
  SpeechSynthesizer,
} from 'microsoft-cognitiveservices-speech-sdk'

import MicrophoneStream from 'microphone-stream';
import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import {fromCognitoIdentityPool} from "@aws-sdk/credential-provider-cognito-identity";
import { Polly,SynthesizeSpeechInput,DescribeVoicesCommand } from "@aws-sdk/client-polly";
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from '@aws-sdk/client-transcribe-streaming';


const defaultAzureRegion = import.meta.env.VITE_REGION
const defaultAzureKey = import.meta.env.VITE_SCRIPTION_KEY
const accessPassword = import.meta.env.VITE_TTS_ACCESS_PASSWORD

interface Config {
  langs?: readonly['fr-FR', 'ja-JP', 'en-US', 'zh-CN', 'zh-HK', 'ko-KR', 'de-DE']
  isFetchAllVoice?: boolean
}
export const useSpeechService = ({ langs = <const>['fr-FR', 'ja-JP', 'en-US', 'zh-CN', 'zh-HK', 'ko-KR', 'de-DE'], isFetchAllVoice = true }: Config = {}) => {
  const { azureKey, azureRegion, ttsPassword,voiceApiName } = useGlobalSetting()
  const { awsCognitoIdentityId, awsRegion, } = useGlobalSetting()


  if(voiceApiName.value==="AWS"){
    isFetchAllVoice=false;
  }
  const resultAzureKey = computed(() => {
    if (!azureKey.value) {
      if (accessPassword !== ttsPassword.value)
        return 'error'

      else return defaultAzureKey || 'error'
    }
    return azureKey.value
  })
  const resultAzureRegion = computed(() => {
    if (!azureKey.value) {
      if (accessPassword !== ttsPassword.value)
        return 'error'
      else
        return defaultAzureRegion || 'error'
    }
    return azureRegion.value
  })

  const languages = ref(langs)
  const language = ref<typeof langs[number]>(langs[0])
  const voiceName = ref('en-US-JennyMultilingualNeural')
  const speechConfig = ref(SpeechConfig.fromSubscription(resultAzureKey.value, resultAzureRegion.value))
  const isRecognizing = ref(false) // 语音识别中
  const isSynthesizing = ref(false) // 语音合成中
  const isSynthesError = ref(false) // 语音失败
  const isRecognizReadying = ref(false) // 语音合成准备中
  const isPlaying = ref(false) // 语音播放中
  const isPlayend = ref(false) // 语音播放结束

  // const isFetchAllVoices = ref(false) // 是否在请求所有语音列表
  const rate = ref(1) // 语速 (0,2]
  const style = ref('Neural') // 情感

  let mediaRecorder: MediaRecorder | null
  const chunks: Blob[] = []
  const audioBlob = ref<Blob>(new Blob())

  const allVoices = ref<VoiceInfo[]>([])
  const allAWSVoices = ref<any[]>([])

  const recognizer = ref<SpeechRecognizer>(new SpeechRecognizer(speechConfig.value))
  const synthesizer = ref<SpeechSynthesizer>(new SpeechSynthesizer(speechConfig.value))
  // 引入变量，触发 SpeechSynthesizer 实例的重新创建
  const count = ref(0)
  const player = ref(new SpeakerAudioDestination())
  watch([language, voiceName, count, azureKey, azureRegion, ttsPassword], ([lang, voice]) => {
    speechConfig.value = SpeechConfig.fromSubscription(resultAzureKey.value, resultAzureRegion.value)
    speechConfig.value.speechRecognitionLanguage = lang
    speechConfig.value.speechSynthesisLanguage = lang
    speechConfig.value.speechSynthesisVoiceName = voice
    console.log(lang, voice)
  }, {
    immediate: true,
  })


  // AWS polly and transcribe SDK 初始化
  const audioAWS = new Audio();
  let micStream: MicrophoneStream | undefined = undefined
  const polly = new Polly({
    region: awsRegion.value ?? "us-east-1",
    credentials: fromCognitoIdentityPool({
      client: new CognitoIdentityClient({ region: awsRegion.value ?? "us-east-1" }),
      identityPoolId: awsCognitoIdentityId.value
    }),
  });

  const transcribe = new TranscribeStreamingClient({
    region: awsRegion.value ?? "us-east-1",
    credentials: fromCognitoIdentityPool({
      client: new CognitoIdentityClient({ region: awsRegion.value ?? "us-east-1" }),
      identityPoolId: awsCognitoIdentityId.value
    }),
  });


  // AZure 语音识别
  const audioRecorder = async () => {
    // 暂时通过 mediaRecorder 方式实现录音保存，后续可能会改为直接通过 SpeechRecognizer 实现保存

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaRecorder = new MediaRecorder(stream)

    mediaRecorder.ondataavailable = (e) => {
      chunks.push(e.data)
    }

    mediaRecorder.onstop = (e) => {
      const blob = new Blob(chunks, { type: 'audio/wav' })
      audioBlob.value = blob
      mediaRecorder = null
      chunks.length = 0
    }

    mediaRecorder.start()
  }

  const startRecognizeSpeech = async (cb?: (text: string) => void) => {
    const audioConfig = AudioConfig.fromDefaultMicrophoneInput()
    recognizer.value = new SpeechRecognizer(speechConfig.value, audioConfig)

    isRecognizReadying.value = true

    recognizer.value.recognized = (s, e) => {
      console.log('Recognize result: ', e.result.text)
      cb && cb(e.result.text)
      // isRecognizing.value = false
    }
    recognizer.value.recognizing = (s, event) => {
      console.log('Recognize recognizing', event.result.text)
    }

    recognizer.value.sessionStopped = (s, e) => {
      console.log('\n    Session stopped event.')
      isRecognizing.value = false
      recognizer.value.stopContinuousRecognitionAsync()
    }

    recognizer.value.canceled = (s, e) => {
      if (e.errorCode === CancellationErrorCode.AuthenticationFailure)
        console.error('Invalid or incorrect subscription key')
      else
        console.error(`Canceled: ${e.errorDetails}`)
      isRecognizReadying.value = false
      isRecognizing.value = false
    }
    recognizer.value.startContinuousRecognitionAsync(async () => {
      isRecognizing.value = true
      isRecognizReadying.value = false
      await audioRecorder()
      console.log('Recognize...')
    },
    (error) => {
      isRecognizing.value = false
      isRecognizReadying.value = false
      console.error(`Error: ${error}`)
      recognizer.value.stopContinuousRecognitionAsync()
    })
  }

  // 停止语音识别
  const stopRecognizeSpeech = (): Promise<void> => {
    mediaRecorder?.stop()
    isRecognizReadying.value = false
    return new Promise((resolve, reject) => {
      recognizer.value.stopContinuousRecognitionAsync(() => {
        isRecognizing.value = false
        resolve()
      }, (err) => {
        isRecognizing.value = false
        console.log('stopRecognizeSpeech error', err)
        reject(err)
      })
    })
  }

  // 识别一次，无需取消
  const recognizeSpeech = (): Promise<string> => {
    isRecognizing.value = true
    return new Promise((resolve, reject) => {
      recognizer.value.recognizeOnceAsync((result) => {
        if (result.text) {
          isRecognizing.value = false
          resolve(result.text)
        }
        else {
          console.log(result)
          isRecognizing.value = false
          reject(new Error(`未识别到任何内容-${language.value}`),
          )
        }
      }, (err) => {
        isRecognizing.value = false
        console.log('recognizeSpeech error', err)
        reject(err)
      })
    })
  }

  // 语音合成
  const textToSpeak = async (text: string, voice?: string) => {
    isSynthesizing.value = true
    speechConfig.value.speechSynthesisVoiceName = voice || speechConfig.value.speechSynthesisVoiceName
    synthesizer.value.speakTextAsync(text, (result) => {
      // if (result.errorDetails)
      //   console.error(`语音播放失败：${result.errorDetails}`)
      // else
      //   console.log('语音播放完成')
      isSynthesizing.value = false
    })
  }

  const ssmlToSpeak = async (text: string, { voice, voiceRate, lang, voiceStyle }: { voice?: string; voiceRate?: number; lang?: string; voiceStyle?: string } = {}) => {
    applySynthesizerConfiguration()

    isSynthesizing.value = true
    isSynthesError.value = false
    const targetLang = lang || speechConfig.value.speechSynthesisLanguage
    const targetVoice = voice || speechConfig.value.speechSynthesisVoiceName
    const targetRate = voiceRate || rate.value
    const targetFeel = voiceStyle || style.value

    const ssml = `
    <speak version="1.0"  xmlns:mstts="https://www.w3.org/2001/mstts" xmlns="https://www.w3.org/2001/10/synthesis" xml:lang="${targetLang}">
      <voice name="${targetVoice}">
        <prosody rate="${targetRate}">
          <mstts:express-as style="${targetFeel}" styledegree="1.5">
            ${text}
          </mstts:express-as>
        </prosody>
      </voice>
    </speak>`
    synthesizer.value.SynthesisCanceled = (s, e) => {
      isSynthesError.value = true
      alert(`语音合成失败,请检查语音配置：${e.result.errorDetails}, `)
      // console.error(`语音合成失败,请检查语音配置：${e.result.errorDetails}`)
    }

    console.log('isSynthesizing')
    synthesizer.value.speakSsmlAsync(ssml, () => {
      console.log('isSynthesiz end')

      stopTextToSpeak()
    }, (err) => {
      console.error('播放失败', err)
      stopTextToSpeak()
    })
  }

  // 停止语音合成
  function stopTextToSpeak() {
    isSynthesizing.value = false
    synthesizer.value.close()
    count.value++ // 触发实例的重新创建
  }

  // 获取语音列表
  async function getVoices(): Promise<VoiceInfo[]> {
    if (isFetchAllVoice) {
      try {
        const synthesizer = new SpeechSynthesizer(speechConfig.value)
        const res = await synthesizer.getVoicesAsync()

        if (res.errorDetails)
          console.error(`获取语音列表失败：${res.errorDetails}, 请检查语音配置`)

        allVoices.value = res.voices || []
      }
      catch (error) {
        allVoices.value = []
      }
      const res = await synthesizer.value.getVoicesAsync()
      if (res.errorDetails) {
        console.error(`获取语音列表失败：${res.errorDetails}, 请检查语音配置`)
        return []
      }
      return res.voices
    }else{
      return []
    }

   
  }

  // 获取AWS 语音列表
  async function getAWSVoices() {
    const params = {
      LanguageCode: "en-US"
    };
  
    try {
      const data = await polly.describeVoices(params)
      if(data.Voices){
        allAWSVoices.value=data.Voices.map((item)=>{
          return {"id":item.Id,"gender":item.Gender}
        })
      }  
      return data.Voices??[];
    } catch (error) {
      console.error("Error retrieving AWS voices:", error);
      return [];
    }

  }


  function applySynthesizerConfiguration() {
    // 通过playback结束事件来判断播放结束
    player.value = new SpeakerAudioDestination()
    player.value.onAudioStart = function (_) {
      if (isSynthesError.value) return
      isPlaying.value = true
      isPlayend.value = false
      console.log('playback started.....')
    }
    player.value.onAudioEnd = function (_) {
      console.log('playback finished....')
      isPlaying.value = false
      isPlayend.value = true
    }

    const speakConfig = AudioConfig.fromSpeakerOutput(player.value)
    synthesizer.value = new SpeechSynthesizer(speechConfig.value, speakConfig)
  }

  /* AWS Vocie service */
  const startAWSRecognizeSpeech = async (cb?: (text: string) => void) => {

    micStream = new MicrophoneStream();
    // // this part should be put into an async function

    micStream.setStream(
      await window.navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true,
      })
    );


    //构造audioSream
    isRecognizing.value = true
    const MAX_AUDIO_CHUNK_SIZE = 48000

    const audioStream = async function* () {
      for await (const chunk of micStream as unknown as Iterable<Buffer>) {
        if (chunk.length <= MAX_AUDIO_CHUNK_SIZE) {
          yield {
            AudioEvent: {
              AudioChunk: pcmEncodeChunk(chunk),
            },
          }
        }
      }
    };

    //PCM 编码
    const pcmEncodeChunk = (chunk: any) => {
      const input = MicrophoneStream.toRaw(chunk);
      var offset = 0;
      var buffer = new ArrayBuffer(input.length * 2);
      var view = new DataView(buffer);
      for (var i = 0; i < input.length; i++, offset += 2) {
        var s = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
      return Buffer.from(buffer);
    };
    //Transcribe stream command 初始化
    const command = new StartStreamTranscriptionCommand({
      LanguageCode: language.value,
      MediaEncoding: "pcm",
      MediaSampleRateHertz: 44100,
      AudioStream: audioStream(),
    });

    const response = await transcribe.send(command);
    let resultText = ""
    if (response.TranscriptResultStream) {
      for await (const event of response.TranscriptResultStream) {
        if (event.TranscriptEvent) {
          const results = event.TranscriptEvent?.Transcript?.Results;
          results?.map((result: any) => {
            (result.Alternatives || []).map((alternative: any) => {
              const transcript = alternative.Items.map((item: any) => item.Content).join(" ");
              resultText = transcript;
              cb && cb(transcript)
            });
          });
        }
      }
      isRecognizing.value = false
    }
    return resultText

  }

  const stopAWSRecognizeSpeech = () => {
    micStream?.stop()
  }


   //语音合成
   const awsTextToSpeak = async (text: string, voice?: string) => {
    const params: SynthesizeSpeechInput = {
      Text: text,
      OutputFormat: 'mp3',
      VoiceId: 'Joanna', // Replace with the desired voice ID (e.g., Joanna, Matthew, etc.)
    };

    const response = await polly.synthesizeSpeech(params);

    if (response.AudioStream) {
      const buffer = await response.AudioStream.transformToByteArray();
      audioAWS.src = URL.createObjectURL(new Blob([buffer], { type: 'audio/mpeg' }));
      audioAWS.play();
    }
  }
  

  return {
    languages,
    language,
    voiceName,
    isRecognizing,
    isPlaying,
    isPlayend,
    isRecognizReadying,
    startRecognizeSpeech,
    stopRecognizeSpeech,
    startAWSRecognizeSpeech,
    stopAWSRecognizeSpeech,
    recognizeSpeech,
    textToSpeak,
    awsTextToSpeak,
    ssmlToSpeak,
    stopTextToSpeak,
    getVoices,
    getAWSVoices,
    allVoices,
    allAWSVoices,
    isSynthesizing,
    rate,
    style,
    audioBlob,
    player,
    audioAWS,
    
  }
}
