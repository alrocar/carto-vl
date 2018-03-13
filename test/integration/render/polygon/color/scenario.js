/* global carto sources */

const map = new carto.Map({
    container: 'map',
    background: 'black'
});

const source = new carto.source.GeoJSON(sources['polygon']);
const style = new carto.Style('color: rgba(1, 0, 0, 1)');
const layer = new carto.Layer('layer', source, style);

layer.addTo(map);
