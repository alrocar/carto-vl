import BaseExpression from './base';
import { implicitCast, checkLooseType, checkExpression, checkType, clamp } from './utils';
import { cielabToSRGB, sRGBToCielab } from '../colorspaces';
import { customPalette } from '../functions';

/**
* Create a color ramp based on input expression.
*
* This expression will asign a color to every possible value in the property.
* If there are more values than colors in the palette, new colors will be generated by linear interpolation.
*
* @param {Category|Property} input - The input expression to give a color
* @param {Palette|Color[]|Number[]} palette - The color palette that is going to be used
* @return {Number|Color}
*
* @example <caption>Display points with a different color depending on the `category` property.</caption>
* const s = carto.expressions;
* const viz = new carto.Viz({
*   color: s.ramp(s.prop('category'), s.palettes.PRISM)
* });
*
* @example <caption>Display points with a different color depending on the `category` property. (String)</caption>
* const viz = new carto.Viz(`
*   color: ramp($category, PRISM)
* `);
*
* @memberof carto.expressions
* @name ramp
* @function
* @api
*/
export default class Ramp extends BaseExpression {
    constructor(input, palette) {
        input = implicitCast(input);
        if (Array.isArray(palette)) {
            palette = customPalette(palette);
        }

        checkExpression('ramp', 'input', 0, input);
        checkLooseType('ramp', 'input', 0, ['number', 'category'], input);
        checkType('ramp', 'palette', 1, ['palette', 'customPalette', 'customPaletteNumber'], palette);

        super({ input: input });
        this.minKey = 0;
        this.maxKey = 1;
        this.palette = palette;
        if (palette.type == 'customPaletteNumber') {
            this.type = 'number';
        } else {
            this.type = 'color';
        }
    }
    eval(o) {
        if (this.palette.type != 'customPaletteNumber') {
            super.eval(o);
        }
        const input = this.input.eval(o);
        const m = (input - this.minKey) / (this.maxKey - this.minKey);
        const len = this.pixel.length - 1;
        const lowIndex = clamp(Math.floor(len * m), 0, len);
        const highIndex = clamp(Math.ceil(len * m), 0, len);
        const low = this.pixel[lowIndex];
        const high = this.pixel[highIndex];
        const fract = len * m - Math.floor(len * m);
        return fract * high + (1 - fract) * low;
    }
    _compile(meta) {
        super._compile(meta);
        checkType('ramp', 'input', 0, ['number', 'category'], this.input);
        if (this.input.type == 'category') {
            this.maxKey = this.input.numCategories - 1;
        }
        const width = 256;
        if (this.type == 'color') {
            const pixel = new Uint8Array(4 * width);
            const colors = this._getColorsFromPalette(this.input, this.palette);
            for (let i = 0; i < width; i++) {
                const vlowRaw = colors[Math.floor(i / (width - 1) * (colors.length - 1))];
                const vhighRaw = colors[Math.ceil(i / (width - 1) * (colors.length - 1))];
                const vlow = [vlowRaw.r / 255, vlowRaw.g / 255, vlowRaw.b / 255, vlowRaw.a];
                const vhigh = [vhighRaw.r / 255, vhighRaw.g / 255, vhighRaw.b / 255, vhighRaw.a];
                const m = i / (width - 1) * (colors.length - 1) - Math.floor(i / (width - 1) * (colors.length - 1));
                const v = interpolate({ r: vlow[0], g: vlow[1], b: vlow[2], a: vlow[3] }, { r: vhigh[0], g: vhigh[1], b: vhigh[2], a: vhigh[3] }, m);
                pixel[4 * i + 0] = v.r * 255;
                pixel[4 * i + 1] = v.g * 255;
                pixel[4 * i + 2] = v.b * 255;
                pixel[4 * i + 3] = v.a * 255;
            }
            this.pixel = pixel;
        } else {
            const pixel = new Float32Array(width);
            const floats = this.palette.floats;
            for (let i = 0; i < width; i++) {
                const vlowRaw = floats[Math.floor(i / (width - 1) * (floats.length - 1))];
                const vhighRaw = floats[Math.ceil(i / (width - 1) * (floats.length - 1))];
                const m = i / (width - 1) * (floats.length - 1) - Math.floor(i / (width - 1) * (floats.length - 1));
                pixel[i] = ((1. - m) * vlowRaw + m * vhighRaw);
            }
            this.pixel = pixel;
        }
    }
    _free(gl) {
        gl.deleteTexture(this.texture);
    }
    _applyToShaderSource(getGLSLforProperty) {
        const input = this.input._applyToShaderSource(getGLSLforProperty);
        return {
            preface: this._prefaceCode(input.preface + `
        uniform sampler2D texRamp${this._uid};
        uniform float keyMin${this._uid};
        uniform float keyWidth${this._uid};
        `),
            inline: this.palette.type == 'customPaletteNumber' ?
                `(texture2D(texRamp${this._uid}, vec2((${input.inline}-keyMin${this._uid})/keyWidth${this._uid}, 0.5)).a)`
                : `texture2D(texRamp${this._uid}, vec2((${input.inline}-keyMin${this._uid})/keyWidth${this._uid}, 0.5)).rgba`
        };
    }
    _getColorsFromPalette(input, palette) {
        if (palette.type == 'palette') {
            let colors;
            if (input.numCategories) {
                // If we are not gonna pop the others we don't need to get the extra color
                const subPalette = (palette.tags.includes('qualitative') && !input.othersBucket) ? input.numCategories : input.numCategories - 1;
                if (palette.subPalettes[subPalette]) {
                    colors = palette.subPalettes[subPalette];
                } else {
                    // More categories than palettes, new colors will be created by linear interpolation
                    colors = palette.getLongestSubPalette();
                }
            } else {
                colors = palette.getLongestSubPalette();
            }
            // We need to remove the 'others' color if the palette has it (it is a qualitative palette) and if the input doesn't have a 'others' bucket
            if (palette.tags.includes('qualitative') && !input.othersBucket) {
                colors = colors.slice(0, colors.length - 1);
            }
            return colors;
        } else {
            return palette.colors;
        }
    }
    _postShaderCompile(program, gl) {
        if (!this.init) {
            this.init = true;
            this.texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            const width = 256;
            const pixel = this.pixel;
            if (this.type == 'color') {
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA,
                    width, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                    pixel);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            } else {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA,
                    width, 1, 0, gl.ALPHA, gl.FLOAT,
                    pixel);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            }

            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }
        this.input._postShaderCompile(program, gl);
        this._getBinding(program).texLoc = gl.getUniformLocation(program, `texRamp${this._uid}`);
        this._getBinding(program).keyMinLoc = gl.getUniformLocation(program, `keyMin${this._uid}`);
        this._getBinding(program).keyWidthLoc = gl.getUniformLocation(program, `keyWidth${this._uid}`);
    }
    _preDraw(program, drawMetadata, gl) {
        this.input._preDraw(program, drawMetadata, gl);
        gl.activeTexture(gl.TEXTURE0 + drawMetadata.freeTexUnit);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(this._getBinding(program).texLoc, drawMetadata.freeTexUnit);
        gl.uniform1f(this._getBinding(program).keyMinLoc, (this.minKey));
        gl.uniform1f(this._getBinding(program).keyWidthLoc, (this.maxKey) - (this.minKey));
        drawMetadata.freeTexUnit++;
    }
}

function interpolate(low, high, m) {
    const cielabLow = sRGBToCielab({
        r: low.r,
        g: low.g,
        b: low.b,
        a: low.a,
    });
    const cielabHigh = sRGBToCielab({
        r: high.r,
        g: high.g,
        b: high.b,
        a: high.a,
    });

    const cielabInterpolated = {
        l: (1 - m) * cielabLow.l + m * cielabHigh.l,
        a: (1 - m) * cielabLow.a + m * cielabHigh.a,
        b: (1 - m) * cielabLow.b + m * cielabHigh.b,
        alpha: (1 - m) * cielabLow.alpha + m * cielabHigh.alpha,
    };

    return cielabToSRGB(cielabInterpolated);
}
