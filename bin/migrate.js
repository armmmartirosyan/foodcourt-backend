import {Slides, Offers, Categories, Products, News, Map, MapImages} from "../models";

async function main() {
    for (const Model of [Slides, Offers, Categories, Products, News, Map, MapImages]) {
        console.log(Model);

        await Model.sync({alter: true});
    }

    process.exit();
}
main();
