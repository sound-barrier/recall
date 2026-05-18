# Shared helpers for the Recall scripts in this directory.
# Source from another script with:
#   . "$(dirname "$0")/_lib.sh"
#
# Not executable on its own (leading underscore signals "library, not a
# command").

# docker_config_aside moves ~/.docker/config.json out of the way for the
# duration of the calling script if it references a credential helper whose
# binary isn't on PATH (typically `docker-credential-gcloud`, left behind
# by `gcloud auth configure-docker` after gcloud was removed). Podman's
# image-pull path falls through to that file for credHelpers / credsStore
# even when its own auth.json exists, so the fix has to live in the Docker
# config layer.
#
# Registers a trap on EXIT so the file is restored even on Ctrl-C or
# mid-script failure — the user's gcloud setup keeps working for whatever
# else uses it.
docker_config_aside() {
    local cfg="$HOME/.docker/config.json"
    local bak="$HOME/.docker/config.json.recall-bak"
    if [[ -f "$cfg" ]] \
        && grep -qE '"(credsStore|credHelpers)"' "$cfg" \
        && ! command -v docker-credential-gcloud >/dev/null 2>&1; then
        echo "→ ~/.docker/config.json references docker-credential-gcloud but the binary"
        echo "  is missing — moving it aside for this run only."
        mv "$cfg" "$bak"
        trap '[[ -f "'"$bak"'" ]] && mv "'"$bak"'" "'"$cfg"'"' EXIT
    fi
}
