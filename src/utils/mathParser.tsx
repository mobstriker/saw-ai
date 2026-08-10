import React from 'react';
import katex from 'katex';

/**
 * Helper to safely render LaTeX math formulas using KaTeX
 */
export function renderLatexMath(latex: string, isBlock = false): React.ReactNode {
  try {
    const html = katex.renderToString(latex.trim(), {
      displayMode: isBlock,
      throwOnError: false,
      output: 'htmlAndMathml',
    });

    return (
      <span
        className={isBlock ? 'katex-display my-2 block overflow-x-auto text-center' : 'katex-inline mx-0.5'}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch (error) {
    console.warn('KaTeX render error:', error);
    return <code className="text-xs bg-[#F5F1EA] px-1 rounded text-[#C58B51]">{latex}</code>;
  }
}
