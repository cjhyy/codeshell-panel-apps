# Test-only CPU provider for real cloud transcription acceptance. Not a product image.
FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install --no-install-recommends -y \
    ca-certificates curl git cmake build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch v1.9.4 https://github.com/ggml-org/whisper.cpp.git /source \
    && test "$(git -C /source rev-parse HEAD)" = 927cfce34f31707e17f2bff35c349632fb9e2c3a \
    && cmake -S /source -B /build -DCMAKE_BUILD_TYPE=Release \
       -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF \
       -DGGML_METAL=OFF -DGGML_BLAS=OFF -DWHISPER_BUILD_TESTS=OFF \
       -DCMAKE_EXE_LINKER_FLAGS="-static-libstdc++ -static-libgcc" \
    && cmake --build /build --target whisper-server -j 2
RUN mkdir /fixture \
    && curl -fL --retry 2 --max-time 180 -o /fixture/ggml-tiny.en.bin \
       https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin \
    && cp /source/samples/jfk.wav /fixture/jfk.wav \
    && echo '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f  /fixture/ggml-tiny.en.bin' | sha256sum -c - \
    && echo '59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e  /fixture/jfk.wav' | sha256sum -c - \
    && cp /build/bin/whisper-server /fixture/whisper-server \
    && cp /source/LICENSE /fixture/LICENSE \
    && git -C /source rev-parse HEAD > /fixture/REVISION
FROM scratch
COPY --from=build /fixture/ /
