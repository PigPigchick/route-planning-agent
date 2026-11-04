#!/bin/bash
cd "$(dirname "$0")" || exit 1
exec /bin/bash ./启动输电设计系统.command --status "$@"
