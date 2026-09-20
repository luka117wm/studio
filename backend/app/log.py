"""Конфигурация логов. Один формат для приложения и uvicorn, вывод в stderr."""

import logging.config

LOG_FORMAT = "%(asctime)s %(levelname)-8s %(name)s: %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def configure_logging(level: str) -> None:
    """Корневой логгер в stderr; логгеры uvicorn без своих хендлеров пишут через него."""
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "default": {"format": LOG_FORMAT, "datefmt": DATE_FORMAT},
            },
            "handlers": {
                "stderr": {
                    "class": "logging.StreamHandler",
                    "formatter": "default",
                    "stream": "ext://sys.stderr",
                },
            },
            "root": {"level": level, "handlers": ["stderr"]},
            "loggers": {
                # uvicorn ставит свои хендлеры при старте — перекрываем, чтобы формат был общий.
                "uvicorn": {"handlers": [], "propagate": True},
                "uvicorn.error": {"handlers": [], "propagate": True},
                "uvicorn.access": {"handlers": [], "propagate": True},
            },
        }
    )
