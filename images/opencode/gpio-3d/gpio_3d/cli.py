import argparse
import json
import sys

from gpio_3d.errors import Gpio3dError
from gpio_3d.export import inspect_dir, model_dir, preview_dir, write_part
from gpio_3d.mesh import clip_mesh, shroud_mesh, spacer_mesh
from gpio_3d.recipe import library_source, parse_recipe, read_raw, save_recipe


def main(argv=None):
    parser = argparse.ArgumentParser(prog="gpio-3d")
    sub = parser.add_subparsers(dest="command", required=True)

    clip = sub.add_parser("clip")
    add_header(clip)
    clip.add_argument("--thickness", required=True, type=float)
    clip.set_defaults(func=run_clip)

    spacer = sub.add_parser("spacer")
    add_header(spacer)
    spacer.add_argument("--height", required=True, type=float)
    spacer.add_argument("--hole", required=True, type=float)
    spacer.set_defaults(func=run_spacer)

    shroud = sub.add_parser("shroud")
    add_header(shroud)
    shroud.add_argument("--height", required=True, type=float)
    shroud.add_argument("--wall", required=True, type=float)
    shroud.set_defaults(func=run_shroud)

    build = sub.add_parser("build")
    build.add_argument("recipe")
    build.add_argument("--dir", required=True)
    build.add_argument("--save")
    build.add_argument("--patch")
    build.set_defaults(func=run_build)

    inspect = sub.add_parser("inspect")
    inspect.add_argument("dir")
    inspect.add_argument("--name")
    inspect.set_defaults(func=run_inspect)

    preview = sub.add_parser("preview")
    preview.add_argument("dir")
    preview.add_argument("--name")
    preview.add_argument("--out")
    preview.add_argument("--size", type=int, default=520)
    preview.add_argument("--elev", type=float, default=18.0)
    preview.add_argument("--turn", type=float, default=0.0)
    preview.set_defaults(func=run_preview)

    args = parser.parse_args(argv)
    try:
        args.func(args)
    except Gpio3dError as exc:
        print(exc, file=sys.stderr)
        return 1
    return 0


def add_header(parser):
    parser.add_argument("--name", required=True)
    parser.add_argument("--cols", required=True, type=int)
    parser.add_argument("--rows", required=True, type=int)
    parser.add_argument("--fits", action="append", required=True)
    parser.add_argument("--dir", required=True)
    parser.add_argument("--color")


def run_clip(args):
    write_part(clip_mesh(args.cols, args.rows, args.thickness), args.name, args.fits, args.dir, args.color)


def run_spacer(args):
    write_part(
        spacer_mesh(args.cols, args.rows, args.height, args.hole),
        args.name,
        args.fits,
        args.dir,
        args.color,
    )


def run_shroud(args):
    write_part(
        shroud_mesh(args.cols, args.rows, args.height, args.wall),
        args.name,
        args.fits,
        args.dir,
        args.color,
    )


def run_build(args):
    patch = None
    if args.patch:
        try:
            patch = json.loads(args.patch)
        except json.JSONDecodeError as exc:
            raise Gpio3dError("--patch must be valid JSON") from exc
    directory = model_dir(args.dir)
    data, mesh = parse_recipe(read_raw(args.recipe, directory), patch)
    write_part(mesh, data["name"], data["fits"], directory, data["color"])
    save_recipe(directory, data, library_source(args.recipe, directory) or args.save)


def run_inspect(args):
    inspect_dir(args.dir, args.name)


def run_preview(args):
    preview_dir(args.dir, args.name, args.out, max(120, min(args.size, 2048)), args.elev, args.turn)


if __name__ == "__main__":
    raise SystemExit(main())
