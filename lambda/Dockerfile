FROM public.ecr.aws/lambda/nodejs:20

# Install dependencies for downloading and extracting
RUN dnf install -y tar gzip && dnf clean all

# Download and install Stockfish from official releases
RUN curl -L https://github.com/official-stockfish/Stockfish/releases/download/sf_17/stockfish-ubuntu-x86-64-avx2.tar -o /tmp/stockfish.tar && \
    tar -xf /tmp/stockfish.tar -C /tmp && \
    mv /tmp/stockfish/stockfish-ubuntu-x86-64-avx2 /usr/local/bin/stockfish && \
    chmod +x /usr/local/bin/stockfish && \
    rm -rf /tmp/stockfish /tmp/stockfish.tar

# Copy package files and set permissions
COPY --chmod=644 package*.json ${LAMBDA_TASK_ROOT}/

# Install dependencies
WORKDIR ${LAMBDA_TASK_ROOT}
RUN npm ci --omit=dev

# Copy function code and set permissions
COPY --chmod=644 index.js ${LAMBDA_TASK_ROOT}/

# Ensure all files are readable
RUN chmod -R a+r ${LAMBDA_TASK_ROOT}

# Set the CMD to your handler
CMD [ "index.handler" ]
