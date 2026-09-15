"""Bounded translation from absolute offsets to one-based QQ API pages."""

WINDOW_SIZE = 50


async def window(fetch, field: str, limit: int, offset: int):
    """Return cropped items and first response metadata, fetching at most two pages.

    Every page uses the same upstream size, so changing the in-page skip never
    changes its absolute start. A short first page is already the upstream tail.
    """
    if isinstance(limit, bool) or not isinstance(limit, int) or limit <= 0:
        raise ValueError("invalid page size")
    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        raise ValueError("invalid page offset")
    limit = min(limit, WINDOW_SIZE)
    page, skip = divmod(offset, WINDOW_SIZE)
    first = await fetch(page=page + 1, num=WINDOW_SIZE)
    items = getattr(first, field)
    result = items[skip : skip + limit]
    if skip + limit > WINDOW_SIZE and len(items) == WINDOW_SIZE:
        second = await fetch(page=page + 2, num=WINDOW_SIZE)
        result += getattr(second, field)[: limit - len(result)]
    return result, first
