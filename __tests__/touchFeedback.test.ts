/**
 * Every button that draws something has to show it has been pressed.
 *
 * `OutlineButton` has done this from the start, and nothing else did — including
 * the button the whole app is for. On a phone that is propped up and tapped
 * without being looked at, a control that reacts only once its state has
 * changed reads as a control that missed the tap, and the second tap undoes the
 * first. Android's ripple does not rescue this: these are `Pressable`s styled
 * as views, not `TouchableNativeFeedback`.
 *
 * Checked against the source rather than a render, for the same reason
 * `workletSafety` compiles the real worklets: `style` is a function here, React
 * resolves it, and the host node a rendered tree exposes carries only the
 * resolved result for the state it happens to be in. What has to be true is a
 * property of the JSX.
 *
 * The rule, and both halves of it are the exemption:
 *  - a `Pressable` with **children** draws something, so it can show a press.
 *    A childless one is a backdrop or a dismiss layer — invisible by design,
 *    with nothing to shade.
 *  - `accessibilityRole="switch"` is exempt from the feedback half: the switch
 *    animates its own knob, which is the feedback.
 * A `Pressable` with children must also carry an interactive role, which is the
 * rule `accessibility.test.tsx` states for the reader and this one states for
 * the finger — the confirm dialog's two buttons were missing both.
 *
 * @format
 */

/// <reference types="node" />

import { readdirSync, readFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'src');

const INTERACTIVE_ROLES = ['button', 'tab', 'menuitem', 'switch', 'link', 'checkbox', 'radio'];

interface Found {
  where: string;
  role: string | null;
  hasChildren: boolean;
  hasFeedback: boolean;
}

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) ? [path] : [];
  });
}

/** Every `<Pressable>` in `src`, with what it declares. */
function pressables(): Found[] {
  const found: Found[] = [];
  for (const file of sources(SRC)) {
    const code = readFileSync(file, 'utf8');
    const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    traverse(ast, {
      JSXOpeningElement(path) {
        if (!t.isJSXIdentifier(path.node.name, { name: 'Pressable' })) return;

        let role: string | null = null;
        let hasFeedback = false;
        for (const attribute of path.node.attributes) {
          if (!t.isJSXAttribute(attribute)) continue;
          const name = attribute.name.name;
          if (name === 'accessibilityRole' && t.isStringLiteral(attribute.value)) {
            role = attribute.value.value;
          }
          // A ripple is feedback the platform draws; a `pressed` parameter is
          // feedback we draw. Either answers the question.
          if (name === 'android_ripple') hasFeedback = true;
          if (name === 'style' && attribute.value != null) {
            hasFeedback = hasFeedback || /\bpressed\b/.test(generate(attribute.value).code);
          }
        }

        const parent = path.parent;
        found.push({
          where: `${relative(ROOT, file)}:${path.node.loc?.start.line}`,
          role,
          hasChildren: t.isJSXElement(parent) && parent.children.some(
            child => !t.isJSXText(child) || child.value.trim() !== '',
          ),
          hasFeedback,
        });
      },
    });
  }
  return found;
}

const ALL = pressables();

describe('the scan itself', () => {
  it('finds the pressables it is supposed to be checking', () => {
    // A rule that matches nothing passes forever. The exact count is not the
    // point — that there are many of them, in more than a couple of files, is.
    expect(ALL.length).toBeGreaterThan(15);
    expect(new Set(ALL.map(p => p.where.split(':')[0])).size).toBeGreaterThan(8);
  });

  it('sees both kinds: ones that draw, and backdrops that do not', () => {
    expect(ALL.some(p => p.hasChildren)).toBe(true);
    expect(ALL.some(p => !p.hasChildren)).toBe(true);
  });
});

describe('a pressable that draws something', () => {
  const drawing = ALL.filter(p => p.hasChildren);

  it('says what it is to a screen reader', () => {
    const roleless = drawing.filter(p => p.role == null || !INTERACTIVE_ROLES.includes(p.role));
    expect(roleless.map(p => p.where)).toEqual([]);
  });

  it('shows that it has been pressed', () => {
    // A switch is exempt: its knob slides, which is the feedback.
    const silent = drawing.filter(p => !p.hasFeedback && p.role !== 'switch');
    expect(silent.map(p => p.where)).toEqual([]);
  });
});
