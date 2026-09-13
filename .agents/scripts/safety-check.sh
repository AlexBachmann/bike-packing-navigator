#!/bin/bash

# Exit on any error during execution
set -e

# Read stdin
INPUT=$(cat)

# Extract toolCall name and CommandLine
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolCall.name // empty')
COMMAND_LINE=$(echo "$INPUT" | jq -r '.toolCall.args.CommandLine // empty')

# Default to allow
DECISION="allow"
REASON=""

if [ "$TOOL_NAME" = "run_command" ]; then
  # Strip leading/trailing whitespaces/tabs
  CLEANED_COMMAND=$(echo "$COMMAND_LINE" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

  # List of approved commands that can be executed directly on the host
  APPROVED_COMMANDS=("docker" "acli" "gws")

  IS_APPROVED=false
  for cmd in "${APPROVED_COMMANDS[@]}"; do
    if [[ "$CLEANED_COMMAND" =~ ^"$cmd" ]]; then
      IS_APPROVED=true
      break
    fi
  done

  if [ "$IS_APPROVED" = false ]; then
    DECISION="deny"
    REASON="Always execute tool calls within the docker container of this project or use one of the approved host commands (${APPROVED_COMMANDS[*]}). If the tool is not present inside the container, ask the human to install it for you"
  fi
fi

# Print output JSON
if [ "$DECISION" = "deny" ]; then
  jq -n --arg decision "$DECISION" --arg reason "$REASON" '{decision: $decision, reason: $reason}'
else
  if [ "$TOOL_NAME" = "run_command" ] && [[ "$CLEANED_COMMAND" =~ ^docker[[:space:]]+compose ]]; then
    jq -n --arg decision "$DECISION" \
          --arg override1 "command(docker compose)" \
          --arg override2 "command($CLEANED_COMMAND)" \
          '{decision: $decision, permissionOverrides: [$override1, $override2]}'
  else
    jq -n --arg decision "$DECISION" '{decision: $decision}'
  fi
fi
