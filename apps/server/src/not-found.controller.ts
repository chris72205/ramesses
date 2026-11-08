import { All, Controller, NotFoundException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

/**
 * Answers every unmatched path under the API prefix with a JSON 404.
 *
 * When the built web app is served from this process, the static handler's fallback returns
 * index.html for any unknown path so client-side routes work on reload. Fastify's serve-static
 * loader ignores the `exclude` option, so without this catch-all a typo like /api/projcts would
 * come back as HTML with status 200. Specific routes always win over this wildcard.
 */
@ApiExcludeController()
@Controller()
export class NotFoundController {
  /** The bare prefix itself (`/api`). */
  @All()
  public handleRoot(): never {
    throw new NotFoundException();
  }

  /** Everything below it. Fastify's own wildcard syntax; `{*path}` is not accepted here. */
  @All('*')
  public handle(): never {
    throw new NotFoundException();
  }
}
