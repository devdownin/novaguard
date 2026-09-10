# Reproducible Android build environment for NovaGuard.
#
# The APK build otherwise reinstalls the whole SDK on every CI run, and needs a
# developer to have a matching toolchain locally — two ways for the build to
# depend on something nobody wrote down. Every version here is the one
# `android/build.gradle` and the React Native gradle plugin actually request,
# so the image drifting from the project is a build failure rather than a
# subtly different APK.
#
# Toolchain only: the source is mounted at run time, so editing a file does not
# invalidate a multi-gigabyte image.
#
#   docker build -t novaguard-android .
#   docker run --rm -v "$PWD":/app -w /app novaguard-android \
#     bash -lc 'npm ci && cd android && ./gradlew assembleRelease'
#
# The APK lands in android/app/build/outputs/apk/release/. Gradle runs as root
# by default and will leave root-owned build directories on the host; pass
# `--user "$(id -u):$(id -g)"` and mount a writable HOME to avoid that.

FROM eclipse-temurin:17-jdk-noble

# Pinned deliberately. `latest` here would mean the image quietly stops matching
# what the project builds against.
ARG ANDROID_PLATFORM=36
ARG ANDROID_BUILD_TOOLS=36.0.0
ARG ANDROID_NDK=27.1.12297006
ARG ANDROID_CMAKE=3.30.5
ARG NODE_MAJOR=22
# Google publishes command line tools under an opaque build number; this is the
# archive the image is pinned to.
ARG CMDLINE_TOOLS_BUILD=11076708

ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    DEBIAN_FRONTEND=noninteractive

# `git` is not optional: the React Native gradle plugin shells out to it, and
# `unzip` is needed for the command line tools archive below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git unzip \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# sdkmanager insists on living at cmdline-tools/latest; the archive unpacks to
# a bare `cmdline-tools`, so it is moved into place rather than unpacked there.
RUN mkdir -p "${ANDROID_HOME}/cmdline-tools" \
 && curl -fsSL -o /tmp/cmdline-tools.zip \
      "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_BUILD}_latest.zip" \
 && unzip -q /tmp/cmdline-tools.zip -d /tmp \
 && mv /tmp/cmdline-tools "${ANDROID_HOME}/cmdline-tools/latest" \
 && rm /tmp/cmdline-tools.zip

ENV PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"

# The NDK and CMake are required, not optional extras: `newArchEnabled=true`
# means the release build compiles C++.
RUN yes | sdkmanager --licenses > /dev/null \
 && sdkmanager --install \
      "platform-tools" \
      "platforms;android-${ANDROID_PLATFORM}" \
      "build-tools;${ANDROID_BUILD_TOOLS}" \
      "ndk;${ANDROID_NDK}" \
      "cmake;${ANDROID_CMAKE}" > /dev/null

# Gradle itself is not installed: the project pins its version in
# android/gradle/wrapper, and the wrapper is the only thing that should decide.

WORKDIR /app
