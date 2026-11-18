"""Offline sentence embeddings: pinned ONNX CPU model + local tokenizer only."""
import argparse, hashlib, json, pathlib, sys
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

MODEL_SHA = '98a01d88b7de996cdea58c32ca71208c09968d143798814b2ea09d3439dc334f'
TOKENIZER_SHA = '2c3387be76557bd40970cec13153b3bbf80407865484b209e655e5e4729076b8'

def verify(file, expected):
    digest = hashlib.sha256()
    with file.open('rb') as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    if digest.hexdigest() != expected:
        raise ValueError('local model checksum mismatch')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    args = parser.parse_args()
    model = pathlib.Path(args.base).resolve() / 'memory-semantic/model'
    model_file, token_file = model / 'onnx/model_quint8_avx2.onnx', model / 'tokenizer.json'
    verify(model_file, MODEL_SHA)
    verify(token_file, TOKENIZER_SHA)
    tokenizer = Tokenizer.from_file(str(token_file))
    tokenizer.enable_truncation(max_length=128)
    tokenizer.enable_padding(pad_id=tokenizer.token_to_id('[PAD]') or 0, pad_token='[PAD]')
    ort.disable_telemetry_events()
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    session = ort.InferenceSession(str(model_file), sess_options=options, providers=['CPUExecutionProvider'])
    inputs = {i.name for i in session.get_inputs()}
    print(json.dumps({'ready': True, 'dimension': 384}), flush=True)
    for line in sys.stdin:
        request_id = None
        try:
            if len(line) > 200000:
                raise ValueError('size')
            request = json.loads(line)
            request_id = request.get('id')
            texts = request.get('texts')
            if not isinstance(texts, list) or not 1 <= len(texts) <= 16 or any(not isinstance(x, str) or not x or len(x) > 4000 for x in texts):
                raise ValueError('input')
            encodings = tokenizer.encode_batch(texts)
            values = {
                'input_ids': np.array([e.ids for e in encodings], dtype=np.int64),
                'attention_mask': np.array([e.attention_mask for e in encodings], dtype=np.int64),
                'token_type_ids': np.array([e.type_ids for e in encodings], dtype=np.int64),
            }
            output = session.run(None, {key: value for key, value in values.items() if key in inputs})[0]
            mask = values['attention_mask'][..., None]
            vectors = (output * mask).sum(axis=1) / np.maximum(mask.sum(axis=1), 1)
            vectors /= np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)
            if vectors.shape != (len(texts), 384) or not np.isfinite(vectors).all():
                raise ValueError('shape')
            print(json.dumps({'id': request_id, 'vectors': vectors.tolist()}, separators=(',', ':')), flush=True)
        except Exception as error:
            print(json.dumps({'id': request_id, 'error': type(error).__name__}), flush=True)

if __name__ == '__main__':
    main()
