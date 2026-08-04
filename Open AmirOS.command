#!/bin/zsh

# The friendly launcher: starts the resilient background service if needed and
# opens AmirOS in the default browser. Double-click this file whenever you want
# to use AmirOS.
PROJECT_DIR="${0:A:h}"
exec "$PROJECT_DIR/start-whatsapp-bot.command"
