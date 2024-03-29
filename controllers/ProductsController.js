import {Categories, ProdCatRel, Products} from "../models";
import path from "path";
import fs from "fs";
import {v4 as uuidV4} from "uuid";
import HttpError from "http-errors";
import _ from "lodash";
import Joi from "joi";
import Validator from "../middlewares/Validator";
import {joiErrorMessage} from "../services/JoiConfig";

export default class ProductsController {
    static getAllProducts = async (req, res, next) => {
        try {
            const products = await Products.findAll({
                attributes: ['id', 'title']
            });

            res.json({
                status: "ok",
                products,
            });
        } catch (e) {
            next(e);
        }
    }

    static getProducts = async (req, res, next) => {
        try {
            let {
                order = 0,
                page = 1,
                limit = 12,
                title,
                category
            } = req.query;

            const validate = Joi.object({
                order: Joi.number().valid(0, 1, 2, 3).error(new Error(joiErrorMessage.parameter)),
                page: Validator.numGreatOne(false).error(new Error(joiErrorMessage.parameter)),
                limit: Validator.numGreatOne(false).error(new Error(joiErrorMessage.parameter)),
                title: Validator.shortText(false).error(new Error(joiErrorMessage.parameter)),
            }).validate({order, page, limit, title});

            if (validate.error) {
                throw HttpError(422, validate.error);
            }

            page = +page;
            limit = +limit;
            const offset = (page - 1) * limit;
            const orderTypes = Products.getOrderTypes();
            const where = title ? {title: {$like: `%${title.trim()}%`}} : {};

            const count = await Products.findAll({
                where,
                attributes: ['id'],
                include: [{
                    model: Categories,
                    as: 'categories',
                    attributes: [],
                    where: category ? {
                        id: category
                    } : null
                }],
            });

            const totalPages = Math.ceil(count.length / limit);
            const products = await Products.findAll({
                where: {
                    ...where,
                    $or: [
                        ...count.map(prod => {
                            return {
                                id: prod.id
                            }
                        })
                    ]
                },
                include: [{
                    model: Categories,
                    as: 'categories',
                }],
                order: [
                    [
                        orderTypes[order].orderBy,
                        orderTypes[order].type],
                ],
                offset,
                limit
            });

            res.json({
                status: "ok",
                data: !_.isEmpty(products) ? {
                    products,
                    orderTypes,
                    totalPages,
                    page,
                    limit
                } : {},
            });
        } catch (e) {
            next(e);
        }
    }

    static getProductsByCategory = async (req, res, next) => {
        try {
            const {categorySlug} = req.params;
            const {productId} = req.query;

            const validate = Joi.object({
                categorySlug: Validator.shortText(true).error(new Error(joiErrorMessage.parameter)),
            }).validate({categorySlug});

            if (validate.error) {
                throw HttpError(422, validate.error);
            }

            const products = await Products.findAll({
                where: {
                  id: {$not: productId}
                },
                include: [{
                    model: Categories,
                    as: 'categories',
                    required: true,
                    where: {
                        slugName: categorySlug
                    }
                }],
            });

            res.json({
                status: "ok",
                products: products || [],
            });
        } catch (e) {
            next(e);
        }

    };

    static getSingleProduct = async (req, res, next) => {
        try {
            const {slugName} = req.params;

            const validate = Joi.object({
                slugName: Validator.shortText(true).error(new Error(joiErrorMessage.slugName)),
            }).validate({slugName});

            if (validate.error) {
                throw HttpError(422, validate.error);
            }

            const product = await Products.findOne({
                where: {slugName},
                include: [{
                    model: Categories,
                    as: 'categories',
                }]
            });

            res.json({
                status: "ok",
                product: product || {},
            });
        } catch (e) {
            next(e);
        }
    };

    static createProduct = async (req, res, next) => {
        try {
            const {file} = req;
            const {title, description, price, categoryId} = req.body;

            const validate = Joi.object({
                title: Validator.shortText(true).error(new Error(joiErrorMessage.title)),
                description: Validator.longText(true).error(new Error(joiErrorMessage.description)),
                price: Validator.numGreatOne(true).error(new Error(joiErrorMessage.price)),
                categoryId: Validator.idArray(true).error(new Error(joiErrorMessage.categoryId)),
            }).validate({title, description, price, categoryId});

            if (validate.error) {
                throw HttpError(422, validate.error);
            }

            if (_.isEmpty(file) || !['image/png', 'image/jpeg'].includes(file.mimetype)) {
                throw HttpError(422, "Не отправил изображение");
            }

            const imagePath = path.join('files', uuidV4() + '-' + file.originalname);

            fs.renameSync(file.path, Products.getImgPath(imagePath));

            const slugName = await Products.generateSlug(title);

            if (slugName === '-') {
                throw HttpError(403, 'Недопустимый заголовок');
            }

            const createdProduct = await Products.create({
                imagePath,
                title,
                description,
                price,
                slugName,
                type: 'product'
            });

            categoryId.forEach(id => {
                (async () => {
                    const category = await Categories.findOne({where: {id}});

                    if (!_.isEmpty(category)) {
                        await ProdCatRel.create({
                            productId: createdProduct.id,
                            categoryId: category.id,
                        });
                    }
                })()
            });

            res.json({
                status: "ok",
                createdProduct
            })
        } catch (e) {
            if (!_.isEmpty(req.file) && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            next(e);
        }
    }

    static updateProduct = async (req, res, next) => {
        try {
            const {file} = req;
            const {id} = req.params;
            const {title, description, price, categoryId} = req.body;

            const validate = Joi.object({
                id: Validator.numGreatOne(true).error(new Error(joiErrorMessage.id)),
                title: Validator.shortText(false).error(new Error(joiErrorMessage.title)),
                description: Validator.longText(false).error(new Error(joiErrorMessage.description)),
                price: Validator.numGreatOne(false).error(new Error(joiErrorMessage.price)),
                categoryId: Validator.idArray(false).error(new Error(joiErrorMessage.categoryId)),
            }).validate({id, title, description, price, categoryId});

            if (validate.error) {
                throw HttpError(422, validate.error);
            }

            const product = await Products.findOne({where: {id}});
            let slugName = product.slugName;
            let imagePath = '';

            if (_.isEmpty(product)) {
                throw HttpError(403, "Товар с таким ID не найден");
            }

            if (!_.isEmpty(categoryId)) {
                await ProdCatRel.destroy({where: {productId: id}});

                categoryId.forEach(tempId => {
                    (async () => {
                        await ProdCatRel.create({
                            productId: id,
                            categoryId: tempId
                        })
                    })()
                })
            }

            if (title && title !== product.title) {
                slugName = await Products.generateSlug(title);

                if (slugName === '-') {
                    throw HttpError(403, 'Недопустимый заголовок');
                }
            }

            if (!_.isEmpty(file) && ['image/png', 'image/jpeg'].includes(file.mimetype)) {
                imagePath = path.join('files', uuidV4() + '-' + file.originalname);

                fs.renameSync(file.path, Products.getImgPath(imagePath));

                const updateImagePath = Products.getImgPath(product.imagePath);

                if (fs.existsSync(updateImagePath)) fs.unlinkSync(updateImagePath)
            }

            const updatedProduct = await Products.update({
                imagePath: imagePath || product.imagePath,
                slugName,
                title,
                description,
                price,
            }, {where: {id}});

            res.json({
                status: "ok",
                updatedProduct
            })
        } catch (e) {
            if (!_.isEmpty(req.file) && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            next(e);
        }
    }

    static deleteProduct = async (req, res, next) => {
        try {
            const {id} = req.params;

            const validate = Joi.object({
                id: Validator.numGreatOne(true).error(new Error(joiErrorMessage.id)),
            }).validate({id});

            if (validate.error) {
                throw HttpError(422, validate.error);
            }

            const product = await Products.findOne({where: {id}});

            if (_.isEmpty(product)) {
                throw HttpError(403, "Товар с таким ID не найден");
            }

            const delImagePath = Products.getImgPath(product.imagePath);

            if (fs.existsSync(delImagePath)) fs.unlinkSync(delImagePath)

            await ProdCatRel.destroy({where: {productId: id}});

            const deletedProduct = await Products.destroy({where: {id}});

            res.json({
                status: "ok",
                deletedProduct
            });
        } catch (e) {
            next(e);
        }
    };
}
