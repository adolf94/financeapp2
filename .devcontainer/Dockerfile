# Dev environment container for the Finance3 monorepo.
# Provides the full toolchain for the frontend, .NET backend, and Python notif-ingester.
# The Azure emulators (Cosmos DB, SignalR, Azurite) run as sibling compose services.
#
# Build:
#   docker build -f .devcontainer/Dockerfile -t finance3-dev .
#
FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ENV DEBIAN_FRONTEND=noninteractive \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1

ENV DOTNET_ROOT=/usr/share/dotnet
ENV PATH="${DOTNET_ROOT}:${DOTNET_ROOT}/tools:/home/vscode/.local/bin:${PATH}"

# ---------------------------------------------------------------- system deps --
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
        lsb-release \
        wget \
        zip \
        unzip \
        git \
        jq \
        build-essential \
        python3-venv \
        python3-pip \
    && rm -rf /var/lib/apt/lists/*

# ----------------------------------------------------------------- .NET 10 SDK --
RUN curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- \
        --channel 10.0 \
        --install-dir "$DOTNET_ROOT"

# --------------------------------------------------------------------- Python --
# Base image ships a system Python; we keep a dedicated venv per project, so only
# ensure `python3` and `pip` are available.
RUN pip3 install --no-cache-dir --break-system-packages --disable-pip-version-check pip

# ------------------------------------------------------- Azure Functions CLI --
# Azure Functions Core Tools v4 (needed to run both the .NET and Python functions).
RUN curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/repos/microsoft-ubuntu-$(lsb_release -cs)-prod $(lsb_release -cs) main" \
        > /etc/apt/sources.list.d/microsoft.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends azure-functions-core-tools-4 \
    && rm -rf /var/lib/apt/lists/*

# --------------------------------------------------------------------- Node.js --
# Ubuntu 24.04 default Node is old; install a current LTS.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g npm \
    && rm -rf /var/lib/apt/lists/*

# ----------------------------------------------------------------- verify ----
RUN dotnet --version \
    && func --version \
    && node --version && npm --version \
    && python3 --version

# Non-root user (matches devcontainers/base) and useful aliases.
USER vscode
WORKDIR /workspaces/finance3

# Friendly defaults for running the stack.
RUN echo 'alias dev-stack="/workspaces/finance3/.devcontainer/scripts/dev-stack.sh"' >> ~/.bashrc \
    && echo 'alias dev-up="/workspaces/finance3/.devcontainer/scripts/dev-up.sh"' >> ~/.bashrc \
    && echo 'alias dev-down="/workspaces/finance3/.devcontainer/scripts/dev-up.sh --down"' >> ~/.bashrc

CMD ["sleep", "infinity"]
