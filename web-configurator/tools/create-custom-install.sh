#!/bin/bash
#
# Create a custom user installation package for the Remote Two.
# Installable with the REST Core-API:
#   POST /api/system/install/web_configurator?void_warranty=$MAGIC_WORD
#
# curl "http://$IP/api/system/install/web_configurator?void_warranty=$MAGIC_WORD" \
#   -u "web-configurator:$PIN" \
#   --form "file=@uc-web-configurator-$VERSION.tar.gz"
#

set -u
set -e

SCRIPT_DIR="$( cd "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"
cd "$SCRIPT_DIR"

# version.txt (repo root) takes precedence when present, e.g. when an earlier
# build step froze the version before dirtying the working tree.
BUILD_VERSION=$("$SCRIPT_DIR/git-version.sh" "$SCRIPT_DIR/../version.txt")
BUILD_DATE=$(date -I)


cp release.json ../dist
cd ../dist

sed -i.bak "s/\$VERSION/$BUILD_VERSION/g" release.json
sed -i.bak "s/\$DATE/$BUILD_DATE/g" release.json
rm *.bak

tar czvf "../uc-web-configurator-$BUILD_VERSION.tar.gz" .

echo "Created archive: ../uc-web-configurator-$BUILD_VERSION.tar.gz"
