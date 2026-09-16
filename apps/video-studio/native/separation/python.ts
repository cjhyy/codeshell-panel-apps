/** Reviewed, bundled Python adapter. Inference is offline and uses only the pinned local ONNX file. */
export const SEPARATION_PYTHON = String.raw`
import sys, os, json, logging, socket
# The installer owns downloads. A missing weight or library never triggers network inference.
def offline(*args, **kwargs):
    raise RuntimeError("Audio separation inference is offline; use the explicit setup action")
socket.create_connection = offline
socket.socket.connect = offline
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
import numpy as np
import soundfile as sf
import torch
from audio_separator.separator import Separator
torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
MODEL = 'UVR_MDXNET_KARA_2.onnx'
DATA = {'compensate':1.065,'mdx_dim_f_set':2048,'mdx_dim_t_set':8,'mdx_n_fft_scale_set':5120,'primary_stem':'Instrumental','is_karaoke':True}
class LocalSeparator(Separator):
    def setup_accelerated_inferencing_device(self):
        self.torch_device_cpu = torch.device('cpu')
        self.torch_device = self.torch_device_cpu
        self.torch_device_mps = None
        self.onnx_execution_provider = ['CPUExecutionProvider']
    def download_file_if_not_exists(self, *args):
        return offline()
    def download_model_files(self, filename):
        if filename != MODEL: raise RuntimeError('Unsupported separation model')
        return MODEL, 'MDX', MODEL, os.path.join(self.model_file_dir, MODEL), None
    def load_model_data_using_hash(self, path):
        return DATA.copy()
source, models, output = sys.argv[1:4]
os.makedirs(output, exist_ok=True)
separator = LocalSeparator(log_level=logging.ERROR, model_file_dir=models, output_dir=output,
    output_format='WAV', normalization_threshold=1.0, amplification_threshold=0.0,
    sample_rate=44100, use_soundfile=True)
# Be explicit even if a future dependency changes its device setup hook.
separator.torch_device = torch.device('cpu')
separator.torch_device_cpu = torch.device('cpu')
separator.torch_device_mps = None
separator.onnx_execution_provider = ['CPUExecutionProvider']
separator.load_model(MODEL)
rate = 44100
with sf.SoundFile(source) as audio:
    if audio.samplerate != rate or audio.channels != 2: raise RuntimeError('Expected stereo 44.1kHz input')
    length = len(audio)
    # Bounded chunks have real context on both sides. Only their central portion is
    # retained, so adjacent chunks never add silence or change the sample count.
    step, context = 30 * rate, 2 * rate
    with sf.SoundFile(os.path.join(output,'vocals.wav'),'w',rate,2,subtype='FLOAT') as voice, \
         sf.SoundFile(os.path.join(output,'instrumental.wav'),'w',rate,2,subtype='FLOAT') as music:
        for start in range(0,length,step):
            end = min(length,start+step)
            lower, upper = max(0,start-context), min(length,end+context)
            audio.seek(lower)
            chunk = audio.read(upper-lower,dtype='float32',always_2d=True)
            path = os.path.join(output,'chunk.wav')
            sf.write(path,chunk,rate,subtype='FLOAT')
            files = separator.separate(path,{'Vocals':'chunk-vocals','Instrumental':'chunk-instrumental'})
            if len(files) != 2: raise RuntimeError('Separation failed to return both stems')
            for name, target in [('vocals',voice),('instrumental',music)]:
                samples, hz = sf.read(os.path.join(output,'chunk-'+name+'.wav'),dtype='float32',always_2d=True)
                if hz != rate or samples.shape != chunk.shape or not np.isfinite(samples).all():
                    raise RuntimeError('Invalid stem samples')
                target.write(samples[start-lower:end-lower])
                os.remove(os.path.join(output,'chunk-'+name+'.wav'))
            os.remove(path)
            print(json.dumps({'fraction':end/length}),flush=True)
print(json.dumps({'sampleRate':rate,'sampleCount':length}),flush=True)
`;
