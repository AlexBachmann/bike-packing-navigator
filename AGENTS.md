# Docker Execution Environment Guidelines

This project comes with a docker execution environment. You recognize this,
because it has a `compose.yml` or a `docker-compose.yml` in the root directory
of the project.

## Execute commands within that docker environment

If a docker environment is present, you are REQUIRED to run all your commands
and tool calls through this docker environment by wrapping the command like
this:

```bash
docker compose exec -T $SERVICE_NAME $COMMAND_LINE
```

Running commands inside the docker environment is an REQUIREMENT, A MUST, this
is NOT OPTIONAL.

### $SERVICE_NAME

The $SERVICE_NAME is usually `app` but might differ on a project basis. You can
find a list of defined services by running `docker compose ps`.

### Starting a container if it is not already running

If the targeted container is not already running, you are allowed to start it by
running `docker compose up -d $SERVICE_NAME` (The app service is defined in the
compose.override.yml)

## Extended execution rights

Unlike on the host environment, the docker execution environment gives you
extended rights and tools you can use. In many cases the human provided you with
`sudo` rights, so you can add dependencies and install packages on demand.

## Extended tools

Within the docker execution environment you might find tools that you do not
find on the host environment.

# Always cleanup after yourself

When you're done and your task is completed, please make sure that your helper
files and programs, which you've created to complete your task have been
deleted. You can use git status for this task.
