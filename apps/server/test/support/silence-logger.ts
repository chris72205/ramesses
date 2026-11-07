import { Logger } from '@nestjs/common';

// Unit tests exercise classes that log through Nest's Logger; keep test output clean.
Logger.overrideLogger(false);
